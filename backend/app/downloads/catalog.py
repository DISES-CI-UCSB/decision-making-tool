from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Protocol

from .access import CONFLICTING_SIRAP
from .errors import BrokerError
from .object_names import object_name_from_reference

# Fields that point at a downloadable object. Nested URL maps are walked too.
_REFERENCE_KEYS = {
    "blobPath",
    "compressedDataForLiveMetricsUrl",
    "displayCogUrl",
    "displayCollectionUrl",
    "displayUrl",
    "mecNationalDenominator",
    "metadataUrl",
    "speciesGoalsCatalog",
    "speciesGoalsTargetOverlay",
    "speciesManifestUrl",
}
# Shared Colombia-wide assets. They stay national on a SIRAP solution so two
# regions do not collide. Confirmed on RuntimeSolutionPrecomputedMetricUrls.
_NATIONAL_REFERENCE_KEYS = frozenset(
    {
        "mecNationalDenominator",
        "speciesGoalsCatalog",
        "speciesGoalsTargetOverlay",
    }
)
_SOLUTION_TOKEN_SEPARATORS = re.compile(r"[_\s]+")


@dataclass(frozen=True)
class CatalogObject:
    object_name: str
    sirap_id: str | None


class ObjectCatalog(Protocol):
    def lookup(self, object_name: str) -> CatalogObject | None: ...

    def version(self) -> str: ...


@dataclass(frozen=True)
class MemoryObjectCatalog:
    objects: dict[str, str | None]
    catalog_version: str = "memory"

    def lookup(self, object_name: str) -> CatalogObject | None:
        if object_name not in self.objects:
            return None
        return CatalogObject(object_name, self.objects[object_name])

    def version(self) -> str:
        return self.catalog_version


class FileObjectCatalog:
    """JSON catalog or published manifest. Reloads when the file mtime changes."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = Lock()
        self._mtime_ns: int | None = None
        self._objects: dict[str, str | None] = {}

    def available(self) -> bool:
        return self._path.is_file()

    def lookup(self, object_name: str) -> CatalogObject | None:
        objects = self._load()
        if object_name not in objects:
            return None
        return CatalogObject(object_name, objects[object_name])

    def version(self) -> str:
        self._load()
        return str(self._mtime_ns or 0)

    def _load(self) -> dict[str, str | None]:
        if not self._path.is_file():
            raise BrokerError(
                503,
                "broker_not_configured",
                "The download catalog is not available.",
            )
        mtime_ns = self._path.stat().st_mtime_ns
        with self._lock:
            if self._mtime_ns == mtime_ns:
                return self._objects
            try:
                document = json.loads(self._path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise BrokerError(
                    503,
                    "broker_not_configured",
                    "The download catalog could not be read.",
                ) from exc
            if not isinstance(document, dict):
                raise BrokerError(
                    503,
                    "broker_not_configured",
                    "The download catalog could not be read.",
                )
            self._objects = index_catalog_document(document)
            self._mtime_ns = mtime_ns
            return self._objects


def index_catalog_document(document: dict[str, object]) -> dict[str, str | None]:
    """Index object key to SIRAP id. A restricted row wins over a national row."""
    index: dict[str, str | None] = {}
    layers = document.get("layers")
    if isinstance(layers, list):
        for layer in layers:
            if isinstance(layer, dict):
                _add_record(index, layer, _clean_sirap(layer.get("sirapId")))
    solutions = document.get("solutions")
    if isinstance(solutions, list):
        for solution in solutions:
            if isinstance(solution, dict):
                sirap_id = _solution_sirap_id(solution)
                _add_record(index, solution, sirap_id)
    objects = document.get("objects")
    if isinstance(objects, dict):
        for name, meta in objects.items():
            if not isinstance(name, str):
                continue
            _assign(index, name, _objects_map_sirap(meta))
    return index


def _objects_map_sirap(meta: object) -> str | None:
    if meta is None:
        return None
    if isinstance(meta, str):
        return _clean_sirap(meta)
    if isinstance(meta, dict):
        return _clean_sirap(meta.get("sirap_id", meta.get("sirapId")))
    return CONFLICTING_SIRAP


def _add_record(index: dict[str, str | None], record: dict[str, object], sirap_id: str | None) -> None:
    for reference, national in _collect_references(record):
        object_name = object_name_from_reference(reference)
        if object_name is not None:
            _assign(index, object_name, None if national else sirap_id)


def _collect_references(node: object) -> list[tuple[str, bool]]:
    found: list[tuple[str, bool]] = []
    if not isinstance(node, dict):
        return found
    for key, value in node.items():
        if key in _REFERENCE_KEYS or key.endswith("Url") or key.endswith("Urls") or key.endswith("Path"):
            _collect_strings(value, found, key in _NATIONAL_REFERENCE_KEYS)
    return found


def _collect_strings(node: object, found: list[tuple[str, bool]], national: bool) -> None:
    if isinstance(node, str):
        found.append((node, national))
        return
    if isinstance(node, dict):
        for key, value in node.items():
            _collect_strings(value, found, national or key in _NATIONAL_REFERENCE_KEYS)
        return
    if isinstance(node, list):
        for value in node:
            _collect_strings(value, found, national)


def _assign(index: dict[str, str | None], object_name: str, sirap_id: str | None) -> None:
    key = object_name_from_reference(object_name)
    if not key:
        return
    if key not in index:
        index[key] = sirap_id
        return
    current = index[key]
    if current == sirap_id:
        return
    if current is None:
        index[key] = sirap_id
        return
    if sirap_id is None:
        return
    index[key] = CONFLICTING_SIRAP


def _solution_sirap_id(solution: dict[str, object]) -> str | None:
    if _solution_scope(solution) != "sirap":
        return None
    sirap_id = _clean_sirap(solution.get("sirapId"))
    # A SIRAP-scoped solution with no region would otherwise look national.
    return CONFLICTING_SIRAP if sirap_id is None else sirap_id


def _solution_scope(solution: dict[str, object]) -> str:
    """Match canAccessSolution: finderInputs.scope || scope, then normalizeSolutionToken."""
    finder_inputs = solution.get("finderInputs")
    raw: object = solution.get("scope")
    if isinstance(finder_inputs, dict):
        candidate = finder_inputs.get("scope")
        if candidate:
            raw = candidate
    return _normalize_solution_token(raw)


def _normalize_solution_token(value: object) -> str:
    """Trim, lowercase, and collapse separators. Same shape as normalizeSolutionToken."""
    if not isinstance(value, str):
        return ""
    return _SOLUTION_TOKEN_SEPARATORS.sub("-", value.strip().lower())


def _clean_sirap(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return CONFLICTING_SIRAP
    if value == "":
        return None
    return value
