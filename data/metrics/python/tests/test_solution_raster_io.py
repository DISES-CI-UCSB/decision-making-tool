import numpy as np
import rasterio
from rasterio.transform import from_origin

from raster_metrics import read_solution_raster


def test_read_solution_raster_counts_all_positive_valid_cells(tmp_path):
    raster_path = tmp_path / "solution.tif"
    data = np.array([[0, 1, 2, 255]], dtype=np.uint8)

    with rasterio.open(
        raster_path,
        "w",
        driver="GTiff",
        height=1,
        width=4,
        count=1,
        dtype=data.dtype,
        crs="EPSG:32618",
        transform=from_origin(0, 1, 1, 1),
        nodata=255,
    ) as dataset:
        dataset.write(data, 1)

    raster = read_solution_raster(raster_path)

    assert raster.valid_cells == 3
    assert raster.selected_cells == 2
    assert raster.selected_mask.tolist() == [[False, True, True, False]]
