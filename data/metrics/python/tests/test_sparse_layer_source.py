"""Focused safety and parity tests for indexed binary layer sources."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import main as pipeline
from raster_metrics import RasterFingerprint, overlap_km2
from sparse.format import (
    LAYER_TYPE_BINARY,
    SparseArtifact,
    SparseMetadata,
    encode_sparse_artifact,
)
from sparse.layer_source import (
    IndexedBinaryLayerSource,
    LayerSourceDiagnostic,
    SparseLayerBinding,
    SparseLayerIncompatibleError,
    SparseLayerUnavailableError,
    binary_selection_values,
    choose_binary_mask,
    layer_source_mode,
    parse_source_nodata_pin,
    validated_sparse_url,
)


def _fingerprint(width: int = 4, height: int = 3) -> RasterFingerprint:
    return RasterFingerprint(
        width=width,
        height=height,
        transform=(1.0, 0.0, -79.0, 0.0, -1.0, 13.0),
        crs="EPSG:4326",
    )


def _encoded_binary(
    cell_ids: np.ndarray,
    *,
    fingerprint: RasterFingerprint | None = None,
    source_pathname: str = "inputs/features/test-layer.tif",
    source_sha256: str = "a" * 64,
    nodata: float | int | None = 255,
    selected_values: tuple[int, ...] = (1,),
) -> bytes:
    grid = fingerprint or _fingerprint()
    metadata = SparseMetadata(
        width=grid.width,
        height=grid.height,
        x_origin=grid.transform[2],
        y_origin=grid.transform[5],
        x_scale=grid.transform[0],
        y_scale=grid.transform[4],
        nodata=nodata,
        crs=grid.crs,
        count=int(cell_ids.size),
        transform=grid.transform,
        source_pathname=source_pathname,
        source_sha256=source_sha256,
        selected_values=selected_values,
    )
    return encode_sparse_artifact(
        SparseArtifact(
            layer_type=LAYER_TYPE_BINARY,
            metadata=metadata,
            cell_ids=cell_ids,
        )
    )


def _load(
    blob: bytes,
    *,
    fingerprint: RasterFingerprint | None = None,
    source_sha256: str | None = "a" * 64,
    sparse_sha256: str | None = None,
    expected_nodata: float | int | None = 255,
    has_source_nodata: bool = True,
) -> IndexedBinaryLayerSource:
    return IndexedBinaryLayerSource.from_bytes(
        blob,
        layer_id="test-layer",
        binding=SparseLayerBinding(
            source_url="https://example.test/inputs/features/test-layer.tif",
            source_sha256=source_sha256,
            sparse_url="https://example.test/inputs/features/test-layer.sparse.gz",
            sparse_sha256=sparse_sha256,
            expected_nodata=expected_nodata,
            has_source_nodata=has_source_nodata,
        ),
        expected_fingerprint=fingerprint or _fingerprint(),
    )


def test_loads_sorted_ids_and_materializes_binary_mask():
    cell_ids = np.array([0, 3, 5, 11], dtype=np.uint32)

    source = _load(_encoded_binary(cell_ids))

    assert source.occupied_cell_ids.flags.writeable is False
    np.testing.assert_array_equal(source.occupied_cell_ids, cell_ids)
    np.testing.assert_array_equal(
        source.materialize_mask().ravel(),
        np.isin(np.arange(12), cell_ids),
    )


def test_rejects_grid_mismatch():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))
    mismatched = _fingerprint(width=5, height=3)

    with pytest.raises(SparseLayerIncompatibleError, match="solution grid"):
        _load(blob, fingerprint=mismatched)


def test_rejects_source_pathname_mismatch():
    blob = _encoded_binary(
        np.array([1, 4], dtype=np.uint32),
        source_pathname="inputs/features/other-layer.tif",
    )

    with pytest.raises(SparseLayerIncompatibleError, match="not bound to source"):
        _load(blob)


@pytest.mark.parametrize(
    "fingerprint",
    [
        RasterFingerprint(
            width=4,
            height=3,
            transform=(1.0, 0.0, -79.0, 0.0, -1.0, 13.0),
            crs="EPSG:3857",
        ),
        RasterFingerprint(
            width=4,
            height=3,
            transform=(1.0, 0.0, -78.0, 0.0, -1.0, 13.0),
            crs="EPSG:4326",
        ),
    ],
)
def test_rejects_crs_or_transform_mismatch(fingerprint):
    blob = _encoded_binary(
        np.array([1, 4], dtype=np.uint32),
        fingerprint=fingerprint,
    )

    with pytest.raises(SparseLayerIncompatibleError, match="solution grid"):
        _load(blob)


def test_rejects_selection_mismatch():
    blob = _encoded_binary(
        np.array([1, 4], dtype=np.uint32),
        selected_values=(2,),
    )

    with pytest.raises(SparseLayerIncompatibleError, match="selection values"):
        _load(blob)


def test_rejects_unsorted_cell_ids():
    blob = _encoded_binary(np.array([4, 1], dtype=np.uint32))

    with pytest.raises(SparseLayerIncompatibleError, match="strictly sorted"):
        _load(blob)


def test_rejects_out_of_bounds_cell_ids():
    blob = _encoded_binary(np.array([1, 12], dtype=np.uint32))

    with pytest.raises(SparseLayerIncompatibleError, match="out-of-grid"):
        _load(blob)


def test_rejects_stale_source_binding():
    blob = _encoded_binary(
        np.array([1, 4], dtype=np.uint32),
        source_sha256="b" * 64,
    )

    with pytest.raises(SparseLayerIncompatibleError, match="checksum"):
        _load(blob)


def test_rejects_missing_trusted_source_checksum():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))

    with pytest.raises(SparseLayerIncompatibleError, match="Missing trusted source"):
        _load(blob, source_sha256=None)


def test_rejects_wrong_sidecar_checksum_before_decode():
    blob = b"not a gzip stream"

    with pytest.raises(SparseLayerIncompatibleError, match="artifact checksum"):
        _load(blob, sparse_sha256="f" * 64)


def test_accepts_matching_sidecar_checksum():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))

    source = _load(blob, sparse_sha256=hashlib.sha256(blob).hexdigest())

    assert source.sparse_sha256 == hashlib.sha256(blob).hexdigest()


def test_rejects_nodata_contract_mismatch():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))

    with pytest.raises(SparseLayerIncompatibleError, match="nodata"):
        _load(blob, expected_nodata=0)


def test_rejects_missing_nodata_pin():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))

    with pytest.raises(SparseLayerIncompatibleError, match="sourceNodata"):
        _load(blob, has_source_nodata=False)


def test_accepts_explicit_null_nodata_pin():
    blob = _encoded_binary(
        np.array([1, 4], dtype=np.uint32),
        nodata=None,
    )

    source = _load(blob, expected_nodata=None)

    assert source.nodata is None


def test_rejects_explicit_null_nodata_mismatch():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32), nodata=255)

    with pytest.raises(SparseLayerIncompatibleError, match="nodata"):
        _load(blob, expected_nodata=None)


def test_accepts_numeric_nodata_pin():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32), nodata=255)

    source = _load(blob, expected_nodata=255)

    assert source.nodata == 255


def test_sparse_mode_fails_when_sidecar_is_unavailable():
    dense_calls = 0

    def unavailable():
        raise SparseLayerUnavailableError("missing")

    def dense():
        nonlocal dense_calls
        dense_calls += 1
        return np.ones((2, 2), dtype=bool)

    with pytest.raises(SparseLayerUnavailableError, match="missing"):
        choose_binary_mask(
            "sparse",
            layer_id="test-layer",
            sparse_loader=unavailable,
            dense_loader=dense,
        )
    assert dense_calls == 0


def test_malformed_bytes_are_observable_in_auto_mode():
    diagnostics: list[LayerSourceDiagnostic] = []

    with pytest.warns(RuntimeWarning, match="malformed"):
        mask = choose_binary_mask(
            "auto",
            layer_id="test-layer",
            sparse_loader=lambda: _load(b"not-gzip"),
            dense_loader=lambda: np.zeros((3, 4), dtype=bool),
            record_diagnostic=diagnostics.append,
        )

    assert not mask.any()
    assert diagnostics[0].source_chosen == "dense"
    assert "SparseLayerIncompatibleError" in diagnostics[0].fallback_reason


def test_malformed_bytes_fail_closed_in_sparse_mode():
    with pytest.raises(SparseLayerIncompatibleError, match="malformed"):
        choose_binary_mask(
            "sparse",
            layer_id="test-layer",
            sparse_loader=lambda: _load(b"not-gzip"),
            dense_loader=lambda: pytest.fail("dense fallback must not run"),
        )


def test_auto_mode_safely_falls_back_when_sidecar_is_unavailable():
    expected = np.array([[True, False], [False, True]])
    diagnostics: list[LayerSourceDiagnostic] = []

    def unavailable():
        raise SparseLayerUnavailableError("missing")

    with pytest.warns(RuntimeWarning, match="using dense source"):
        result = choose_binary_mask(
            "auto",
            layer_id="test-layer",
            sparse_loader=unavailable,
            dense_loader=lambda: expected,
            record_diagnostic=diagnostics.append,
        )

    np.testing.assert_array_equal(result, expected)
    assert diagnostics == [
        LayerSourceDiagnostic(
            layer_id="test-layer",
            mode_requested="auto",
            source_chosen="dense",
            fallback_reason="SparseLayerUnavailableError: missing",
        )
    ]


@pytest.mark.parametrize(
    "rendering",
    [
        {"valueType": "binary", "selectedValue": "not-a-number"},
        {"valueType": "binary", "selectedValues": "1,2"},
        {"valueType": "binary", "selectedValues": [1.5]},
        {"valueType": "continuous", "selectedValue": 1},
    ],
)
def test_malformed_rendering_is_normalized(rendering):
    with pytest.raises(SparseLayerIncompatibleError, match="rendering"):
        binary_selection_values(rendering)


def test_dense_is_default(monkeypatch):
    monkeypatch.delenv("METRICS_LAYER_SOURCE", raising=False)
    assert layer_source_mode() == "dense"


def test_manifest_binding_does_not_fabricate_missing_pins():
    source_url = "https://example.test/inputs/features/paramos.tif"

    binding = pipeline._layer_sparse_binding(
        SimpleNamespace(layers_by_id={"paramos": {}}),
        "paramos",
        source_url,
    )

    assert binding == SparseLayerBinding(
        source_url=source_url,
        source_sha256=None,
        sparse_url=None,
    )


def test_manifest_binding_accepts_future_trusted_sparse_contract():
    config = {
        "sourceUrl": "https://example.test/source.tif",
        "sourceSha256": "a" * 64,
        "url": "https://example.test/source.sparse.gz",
        "sha256": "b" * 64,
        "sourceNodata": 255,
    }

    binding = pipeline._layer_sparse_binding(
        SimpleNamespace(layers_by_id={"paramos": {"sparseSource": config}}),
        "paramos",
        "https://example.test/ignored.tif",
    )

    assert binding == SparseLayerBinding(
        source_url=config["sourceUrl"],
        source_sha256=config["sourceSha256"],
        sparse_url=config["url"],
        sparse_sha256=config["sha256"],
        expected_nodata=255,
        has_source_nodata=True,
    )


def test_manifest_binding_distinguishes_explicit_null_nodata():
    config = {
        "sourceUrl": "https://example.test/source.tif",
        "sourceSha256": "a" * 64,
        "url": "https://example.test/source.sparse.gz",
        "sourceNodata": None,
    }

    binding = pipeline._layer_sparse_binding(
        SimpleNamespace(layers_by_id={"paramos": {"sparseSource": config}}),
        "paramos",
        "https://example.test/ignored.tif",
    )

    assert binding.expected_nodata is None
    assert binding.has_source_nodata is True


def test_manifest_binding_parses_json_safe_nan_nodata():
    config = {
        "sourceUrl": "https://example.test/source.tif",
        "sourceSha256": "a" * 64,
        "url": "https://example.test/source.sparse.gz",
        "sourceNodata": "NaN",
    }

    binding = pipeline._layer_sparse_binding(
        SimpleNamespace(layers_by_id={"comunidades": {"sparseSource": config}}),
        "comunidades",
        "https://example.test/ignored.tif",
    )

    assert np.isnan(binding.expected_nodata)
    assert binding.has_source_nodata is True


def test_release_binding_contract_loads_exactly_approved_land_binary_layers():
    path = (
        Path(__file__).parents[2]
        / "release-specs/solutions-v3-0-0/land-binary-sparse-bindings-v1.json"
    )
    contract = json.loads(path.read_text(encoding="utf-8"))

    assert contract["format"] == "land-binary-sparse-bindings-v1"
    assert {layer["layerId"] for layer in contract["layers"]} == {
        "bosque_seco",
        "comunidades",
        "mangroves",
        "paramos",
        "resguardos",
        "wetlands",
    }
    assert contract["grid"] == {
        "width": 1353,
        "height": 1838,
        "transform": [
            1000.0,
            0.0,
            4331309.911856957,
            0.0,
            -999.9999999999999,
            2933186.9308051495,
        ],
        "crs": "EPSG:9377",
    }
    for layer in contract["layers"]:
        binding = SparseLayerBinding(
            source_url=layer["sourceUrl"],
            source_sha256=layer["sourceSha256"],
            sparse_url=layer["sparseUrl"],
            sparse_sha256=layer["sparseSha256"],
            expected_nodata=parse_source_nodata_pin(layer["sourceNodata"]),
            has_source_nodata=True,
        )
        assert validated_sparse_url(binding) == layer["sparseUrl"]
        assert layer["renderingSelection"] == {
            "valueType": "binary",
            "selectedValues": [1],
        }


def test_missing_checksum_is_observable_in_auto_mode():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))
    diagnostics: list[LayerSourceDiagnostic] = []

    with pytest.warns(RuntimeWarning, match="Missing trusted source"):
        mask = choose_binary_mask(
            "auto",
            layer_id="test-layer",
            sparse_loader=lambda: _load(blob, source_sha256=None),
            dense_loader=lambda: np.zeros((3, 4), dtype=bool),
            record_diagnostic=diagnostics.append,
        )

    assert not mask.any()
    assert diagnostics[0].source_chosen == "dense"
    assert "Missing trusted source SHA-256" in diagnostics[0].fallback_reason


def test_missing_checksum_fails_closed_in_sparse_mode():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))
    dense_calls = 0

    def dense():
        nonlocal dense_calls
        dense_calls += 1
        return np.zeros((3, 4), dtype=bool)

    with pytest.raises(SparseLayerIncompatibleError, match="Missing trusted source"):
        choose_binary_mask(
            "sparse",
            layer_id="test-layer",
            sparse_loader=lambda: _load(blob, source_sha256=None),
            dense_loader=dense,
        )
    assert dense_calls == 0


def test_missing_nodata_pin_is_observable_in_auto_mode():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))
    diagnostics: list[LayerSourceDiagnostic] = []

    with pytest.warns(RuntimeWarning, match="sourceNodata"):
        mask = choose_binary_mask(
            "auto",
            layer_id="test-layer",
            sparse_loader=lambda: _load(blob, has_source_nodata=False),
            dense_loader=lambda: np.zeros((3, 4), dtype=bool),
            record_diagnostic=diagnostics.append,
        )

    assert not mask.any()
    assert diagnostics[0].source_chosen == "dense"
    assert "Missing trusted sourceNodata pin" in diagnostics[0].fallback_reason


def test_missing_nodata_pin_fails_closed_in_sparse_mode():
    blob = _encoded_binary(np.array([1, 4], dtype=np.uint32))

    with pytest.raises(SparseLayerIncompatibleError, match="sourceNodata"):
        choose_binary_mask(
            "sparse",
            layer_id="test-layer",
            sparse_loader=lambda: _load(blob, has_source_nodata=False),
            dense_loader=lambda: pytest.fail("dense fallback must not run"),
        )


class _AlignmentStub:
    def align(self, path, *_args):
        return SimpleNamespace(path=path)


def _stub_dense_loading(monkeypatch, expected_mask):
    monkeypatch.setattr(
        pipeline,
        "cached_download",
        lambda url, *_args, **_kwargs: SimpleNamespace(
            url=url,
            path=SimpleNamespace(),
            sha256="d" * 64,
        ),
    )
    monkeypatch.setattr(
        pipeline,
        "read_layer_mask",
        lambda *_args, **_kwargs: expected_mask,
    )


def test_cache_auto_fallback_records_malformed_rendering(monkeypatch):
    monkeypatch.setenv("METRICS_LAYER_SOURCE", "auto")
    expected = np.ones((3, 4), dtype=bool)
    _stub_dense_loading(monkeypatch, expected)
    cache = pipeline._LayerMaskCache(alignment_cache=_AlignmentStub())
    binding = SparseLayerBinding(
        source_url="https://example.test/inputs/features/paramos.tif",
        source_sha256="a" * 64,
        sparse_url="https://example.test/inputs/features/paramos.sparse.gz",
        expected_nodata=255,
        has_source_nodata=True,
    )

    with pytest.warns(RuntimeWarning, match="rendering"):
        result = cache.get(
            "paramos",
            binding.source_url,
            _fingerprint(),
            {"valueType": "binary", "selectedValues": "bad"},
            SimpleNamespace(),
            False,
            allow_sparse=True,
            sparse_binding=binding,
        )

    np.testing.assert_array_equal(result, expected)
    assert cache.source_diagnostics[0].source_chosen == "dense"
    assert "Malformed binary rendering metadata" in (
        cache.source_diagnostics[0].fallback_reason or ""
    )


def test_noneligible_layer_stays_dense_and_is_diagnosed(monkeypatch):
    monkeypatch.setenv("METRICS_LAYER_SOURCE", "auto")
    expected = np.ones((3, 4), dtype=bool)
    _stub_dense_loading(monkeypatch, expected)
    cache = pipeline._LayerMaskCache(alignment_cache=_AlignmentStub())

    result = cache.get(
        "recarga_agua",
        "https://example.test/inputs/features/recarga_agua.tif",
        _fingerprint(),
        {},
        SimpleNamespace(),
        False,
        allow_sparse=True,
    )

    np.testing.assert_array_equal(result, expected)
    assert cache.source_diagnostics == (
        LayerSourceDiagnostic(
            layer_id="recarga_agua",
            mode_requested="auto",
            source_chosen="dense",
            fallback_reason="Layer is not eligible for sparse binary source loading.",
        ),
    )


def test_dense_and_sparse_masks_have_exact_national_and_boundary_parity(
    uniform_raster,
):
    dense_mask = np.array(
        [
            [True, False, True, False],
            [False, True, False, True],
            [True, True, False, False],
            [False, False, True, True],
        ],
        dtype=bool,
    )
    fingerprint = uniform_raster.fingerprint
    cell_ids = np.flatnonzero(dense_mask.ravel()).astype(np.uint32)
    sparse_mask = _load(
        _encoded_binary(cell_ids, fingerprint=fingerprint),
        fingerprint=fingerprint,
    ).materialize_mask()

    boundaries = [
        np.ones_like(dense_mask),
        np.array(
            [
                [True, True, False, False],
                [True, True, False, False],
                [False, False, False, False],
                [False, False, False, False],
            ]
        ),
        np.eye(4, dtype=bool),
    ]
    for boundary in boundaries:
        scoped = uniform_raster.with_boundary_mask(boundary)
        dense_value = overlap_km2(
            scoped.selected_mask,
            dense_mask,
            scoped.pixel_area_km2_per_row,
        )
        sparse_value = overlap_km2(
            scoped.selected_mask,
            sparse_mask,
            scoped.pixel_area_km2_per_row,
        )
        assert sparse_value == dense_value
