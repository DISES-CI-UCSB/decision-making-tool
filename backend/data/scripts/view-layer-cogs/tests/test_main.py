from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

try:
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp, MaskFlags
    from rasterio.transform import from_origin
except ModuleNotFoundError:
    np = None
    rasterio = None


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "main.py"
sys.path.insert(0, str(SCRIPT_PATH.parent))
SPEC = importlib.util.spec_from_file_location("view_layer_cogs_main", SCRIPT_PATH)
assert SPEC and SPEC.loader
main = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = main
SPEC.loader.exec_module(main)


def write_raster(path: Path, values: np.ndarray, transform) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype=values.dtype,
        crs="EPSG:9377",
        transform=transform,
        nodata=0,
    ) as raster:
        raster.write(values, 1)


@unittest.skipUnless(rasterio is not None and np is not None, "rasterio and numpy are required")
class ViewLayerCogTests(unittest.TestCase):
    def test_source_grid_preserves_grid_and_class_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "marine.tif"
            template = root / "template.tif"
            values = np.tile(np.array([[0, 1, 5, 145]], dtype=np.uint16), (1024, 256))
            source_transform = from_origin(0, 1024, 1, 1)
            write_raster(source, values, source_transform)
            write_raster(
                template,
                np.zeros((1024, 1024), dtype=np.uint16),
                from_origin(0, 1024, 1, 1),
            )

            entry = main.build_layer(
                main.ViewLayer(
                    "marine-test",
                    source.as_uri(),
                    "marine.cog.tif",
                    grid_behavior="source-grid",
                    expected_values=frozenset(range(146)),
                ),
                template_path=template,
                cache_dir=root / "cache",
                output_dir=root / "output",
                force_download=False,
            )

            with rasterio.open(entry["outputPath"]) as output:
                self.assertEqual(output.transform, source_transform)
                self.assertEqual((output.width, output.height), (1024, 1024))
                self.assertEqual(output.read(1).tolist(), values.tolist())
                self.assertTrue(output.overviews(1))

    def test_land_template_reprojects_without_reclassification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "land.tif"
            template = root / "template.tif"
            source_values = np.tile(np.array([[1, 2], [3, 4]], dtype=np.uint16), (256, 256))
            write_raster(source, source_values, from_origin(0, 512, 1, 1))
            template_transform = from_origin(0, 512, 0.5, 0.5)
            write_raster(template, np.zeros((1024, 1024), dtype=np.uint16), template_transform)

            entry = main.build_layer(
                main.ViewLayer(
                    "land-test",
                    source.as_uri(),
                    "land.cog.tif",
                    grid_behavior="land-template",
                    expected_values=frozenset({0, 1, 2, 3, 4}),
                ),
                template_path=template,
                cache_dir=root / "cache",
                output_dir=root / "output",
                force_download=False,
            )

            with rasterio.open(entry["outputPath"]) as output:
                self.assertEqual(output.transform, template_transform)
                self.assertEqual((output.width, output.height), (1024, 1024))
                self.assertTrue(set(output.read(1).ravel()).issubset({1, 2, 3, 4}))

    def test_mask_layer_retains_original_presence_semantics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "mask.tif"
            template = root / "template.tif"
            values = np.tile(np.array([[0, 1]], dtype=np.uint8), (512, 512))
            write_raster(source, values, from_origin(0, 1024, 1, 1))
            write_raster(template, np.zeros((1024, 1024), dtype=np.uint8), from_origin(0, 1024, 1, 1))

            entry = main.build_layer(
                main.ViewLayer(
                    "mask-test",
                    source.as_uri(),
                    "mask.cog.tif",
                    grid_behavior="land-template",
                    expected_values=frozenset({0, 1}),
                    presence_value=1,
                ),
                template_path=template,
                cache_dir=root / "cache",
                output_dir=root / "output",
                force_download=False,
            )

            self.assertEqual(entry["displayValues"], [1.0])
            self.assertEqual(entry["outputRaster"]["dtype"], "float32")

    def test_continuous_layer_uses_sentinel_nodata_without_masking_zero(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "continuous.tif"
            template = root / "template.tif"
            values = np.tile(np.array([[0.0, np.nan]], dtype=np.float32), (512, 512))
            transform = from_origin(0, 1024, 1, 1)
            with rasterio.open(
                source,
                "w",
                driver="GTiff",
                width=1024,
                height=1024,
                count=1,
                dtype="float32",
                crs="EPSG:9377",
                transform=transform,
                nodata=np.nan,
            ) as raster:
                raster.write(values, 1)
            write_raster(template, np.zeros((1024, 1024), dtype=np.uint16), transform)

            entry = main.build_layer(
                main.ViewLayer(
                    "continuous-test",
                    source.as_uri(),
                    "continuous.cog.tif",
                    grid_behavior="source-grid",
                    display_nodata=-9999.0,
                ),
                template_path=template,
                cache_dir=root / "cache",
                output_dir=root / "output",
                force_download=False,
            )

            with rasterio.open(entry["outputPath"]) as output:
                data = output.read(1)
                mask = output.dataset_mask()
                self.assertEqual(output.count, 1)
                self.assertEqual(output.nodata, -9999.0)
                self.assertEqual(output.colorinterp, (ColorInterp.gray,))
                self.assertEqual(output.mask_flag_enums[0], [MaskFlags.per_dataset])
                self.assertEqual(data[0, 0], 0.0)
                self.assertEqual(data[0, 1], -9999.0)
                self.assertEqual(mask[0, 0], 255)
                self.assertEqual(mask[0, 1], 0)
                self.assertTrue(output.overviews(1))

            self.assertEqual(entry["outputRaster"]["maskFlags"], ["per_dataset"])
            self.assertEqual(entry["outputRaster"]["maskValues"], [0, 255])

