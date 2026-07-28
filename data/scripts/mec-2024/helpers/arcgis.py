"""Deterministic, resumable ArcGIS FeatureServer downloads."""

from __future__ import annotations

import hashlib
import json
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LAYER_URL = (
    "https://visualizador.ideam.gov.co/gisserver/rest/services/"
    "Estado_Ecosistemas/FeatureServer/1"
)
QUERY_URL = f"{LAYER_URL}/query"
ITEM_ID = "46caafee6f5e4c36ab52bd7b2b2f8629"
ITEM_URL = f"https://www.arcgis.com/sharing/rest/content/items/{ITEM_ID}"
OID_FIELD = "objectid"
REQUIRED_FIELDS = (
    OID_FIELD,
    "tipo_ecos",
    "gran_bioma",
    "bioma_iavh",
    "ecos_sintesis",
    "ecos_general",
    "area_ha",
)
DEFAULT_PAGE_SIZE = 20_000

JsonObject = dict[str, Any]
Transport = Callable[[str, Mapping[str, Any], str], JsonObject]


class ArcGISError(RuntimeError):
    """Raised when ArcGIS returns an invalid or incomplete response."""


class ArcGISResponseError(ArcGISError):
    """Structured ArcGIS error response with retry classification."""

    def __init__(self, *, url: str, error: Mapping[str, Any]) -> None:
        self.url = url
        self.error = dict(error)
        self.code = self._error_code(self.error)
        self.message = str(self.error.get("message") or "Unknown ArcGIS error")
        super().__init__(f"ArcGIS error for {url}: {self.code}: {self.message}")

    @staticmethod
    def _error_code(error: Mapping[str, Any]) -> str:
        message_code = error.get("messageCode")
        code = error.get("code")
        candidates = [message_code, code, error.get("message"), error.get("details")]
        if any("CONT_0001" in str(value) for value in candidates if value is not None):
            return "CONT_0001"
        return str(message_code or code or "unknown")

    @property
    def is_transient(self) -> bool:
        return self.code != "CONT_0001"

    def as_record(self) -> JsonObject:
        details = self.error.get("details")
        return {
            "code": self.code,
            "message": self.message,
            "details": details if isinstance(details, list) else [],
            "transient": self.is_transient,
        }


class ArcGISRequestExhaustedError(ArcGISError):
    """Raised after every retry for one transient request failure is exhausted."""

    def __init__(
        self,
        *,
        method: str,
        url: str,
        attempts: int,
        last_error: Exception | None,
    ) -> None:
        self.method = method
        self.url = url
        self.attempts = attempts
        self.last_error = last_error
        self.failure_kind = self._failure_kind(last_error)
        super().__init__(
            f"ArcGIS request failed after {attempts} attempts: {method} {url}: "
            f"{last_error}"
        )

    @staticmethod
    def _failure_kind(error: Exception | None) -> str:
        if isinstance(error, (json.JSONDecodeError, UnicodeDecodeError)):
            return "malformed-json"
        if isinstance(error, urllib.error.HTTPError):
            return "http"
        if isinstance(error, (urllib.error.URLError, TimeoutError)):
            return "network"
        if isinstance(error, ArcGISResponseError):
            return "arcgis-response"
        return "request"

    def as_record(self) -> JsonObject:
        record: JsonObject = {
            "kind": self.failure_kind,
            "attempts": self.attempts,
            "message": str(self.last_error),
        }
        if isinstance(self.last_error, urllib.error.HTTPError):
            record["httpStatus"] = self.last_error.code
        if isinstance(self.last_error, ArcGISResponseError):
            record["arcgisError"] = self.last_error.as_record()
        return record


def _error_record(error: ArcGISError) -> JsonObject:
    if isinstance(error, ArcGISResponseError):
        return error.as_record()
    return {
        "code": None,
        "message": str(error),
        "details": [],
        "transient": True,
    }


def canonical_json_bytes(value: Any) -> bytes:
    """Encode JSON canonically without changing Unicode labels."""

    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("wb") as target:
        target.write(content)
        target.flush()
        os.fsync(target.fileno())
    temporary.replace(path)


def atomic_write_json(path: Path, value: Any) -> str:
    content = canonical_json_bytes(value)
    atomic_write_bytes(path, content)
    return sha256_bytes(content)


def load_json(path: Path) -> JsonObject:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ArcGISError(f"Could not read valid JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ArcGISError(f"Expected a JSON object in {path}.")
    return value


@dataclass(frozen=True)
class RetryPolicy:
    attempts: int = 5
    initial_backoff_seconds: float = 1.0
    max_backoff_seconds: float = 30.0

    def __post_init__(self) -> None:
        if self.attempts < 1:
            raise ValueError("Retry attempts must be at least 1.")
        if self.initial_backoff_seconds < 0 or self.max_backoff_seconds < 0:
            raise ValueError("Retry backoff values cannot be negative.")


class ArcGISClient:
    """Small JSON client with retry behavior and injectable offline transport."""

    def __init__(
        self,
        *,
        retry_policy: RetryPolicy | None = None,
        timeout_seconds: float = 120.0,
        transport: Transport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.retry_policy = retry_policy or RetryPolicy()
        self.timeout_seconds = timeout_seconds
        self.transport = transport
        self.sleep = sleep

    def request_json(
        self,
        url: str,
        parameters: Mapping[str, Any],
        *,
        method: str,
    ) -> JsonObject:
        if self.transport is not None:
            last_error: Exception | None = None
            for attempt in range(self.retry_policy.attempts):
                try:
                    response = self.transport(url, parameters, method)
                    return self._checked_response(response, url)
                except (
                    ArcGISError,
                    OSError,
                    TimeoutError,
                    json.JSONDecodeError,
                    UnicodeDecodeError,
                ) as exc:
                    last_error = exc
                    if isinstance(exc, ArcGISResponseError) and not exc.is_transient:
                        raise
                    if attempt + 1 == self.retry_policy.attempts:
                        break
                    base = min(
                        self.retry_policy.initial_backoff_seconds * (2**attempt),
                        self.retry_policy.max_backoff_seconds,
                    )
                    self.sleep(base)
            raise ArcGISRequestExhaustedError(
                method=method,
                url=url,
                attempts=self.retry_policy.attempts,
                last_error=last_error,
            ) from last_error

        encoded = urllib.parse.urlencode(
            {
                key: (
                    ",".join(str(item) for item in value)
                    if isinstance(value, (list, tuple))
                    else str(value).lower()
                    if isinstance(value, bool)
                    else value
                )
                for key, value in parameters.items()
                if value is not None
            }
        ).encode("utf-8")
        request_url = f"{url}?{encoded.decode('utf-8')}" if method == "GET" else url
        request = urllib.request.Request(
            request_url,
            data=None if method == "GET" else encoded,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "DISES-MEC-2024-ingestion/1",
            },
            method=method,
        )

        last_error: Exception | None = None
        for attempt in range(self.retry_policy.attempts):
            try:
                with urllib.request.urlopen(
                    request,
                    timeout=self.timeout_seconds,
                ) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                return self._checked_response(payload, url)
            except (
                urllib.error.HTTPError,
                urllib.error.URLError,
                TimeoutError,
                json.JSONDecodeError,
                UnicodeDecodeError,
                ArcGISError,
            ) as exc:
                last_error = exc
                if isinstance(exc, ArcGISResponseError) and not exc.is_transient:
                    raise
                if attempt + 1 == self.retry_policy.attempts:
                    break
                base = min(
                    self.retry_policy.initial_backoff_seconds * (2**attempt),
                    self.retry_policy.max_backoff_seconds,
                )
                self.sleep(base + random.uniform(0, min(base * 0.1, 1.0)))
        raise ArcGISRequestExhaustedError(
            method=method,
            url=url,
            attempts=self.retry_policy.attempts,
            last_error=last_error,
        ) from last_error

    @staticmethod
    def _checked_response(response: Any, url: str) -> JsonObject:
        if not isinstance(response, dict):
            raise ArcGISError(f"ArcGIS returned a non-object response for {url}.")
        error = response.get("error")
        if error:
            if not isinstance(error, dict):
                error = {"message": str(error)}
            raise ArcGISResponseError(url=url, error=error)
        return response


def fetch_metadata(
    client: ArcGISClient,
    cache_dir: Path,
    *,
    strict_item_metadata: bool = False,
) -> JsonObject:
    """Fetch and atomically cache layer, item, count, and schema metadata."""

    layer = client.request_json(LAYER_URL, {"f": "json"}, method="GET")
    count_response = client.request_json(
        QUERY_URL,
        {"f": "json", "where": "1=1", "returnCountOnly": True},
        method="POST",
    )
    try:
        feature_count = int(count_response["count"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ArcGISError(
            "ArcGIS count query did not return an integer count."
        ) from exc

    fields = layer.get("fields")
    if not isinstance(fields, list):
        raise ArcGISError("Layer metadata does not contain a fields array.")
    item: JsonObject | None = None
    try:
        item = client.request_json(ITEM_URL, {"f": "json"}, method="GET")
        item_enrichment = {
            "attempted": True,
            "required": strict_item_metadata,
            "status": "available",
            "itemId": ITEM_ID,
            "url": ITEM_URL,
            "error": None,
        }
    except ArcGISError as exc:
        if strict_item_metadata:
            raise
        item_enrichment = {
            "attempted": True,
            "required": False,
            "status": "unavailable",
            "itemId": ITEM_ID,
            "url": ITEM_URL,
            "error": _error_record(exc),
        }
    schema = [
        {
            "name": field.get("name"),
            "alias": field.get("alias"),
            "type": field.get("type"),
            "nullable": field.get("nullable"),
            "length": field.get("length"),
        }
        for field in fields
        if isinstance(field, dict)
    ]
    metadata = {
        "layerUrl": LAYER_URL,
        "queryUrl": QUERY_URL,
        "itemId": ITEM_ID,
        "itemUrl": ITEM_URL,
        "layer": layer,
        "item": item,
        "itemMetadataEnrichment": item_enrichment,
        "featureCount": feature_count,
        "schemaSha256": sha256_bytes(canonical_json_bytes(schema)),
    }
    atomic_write_json(cache_dir / "metadata.json", metadata)
    return metadata


def fetch_ordered_oids(client: ArcGISClient, cache_dir: Path) -> list[int]:
    """Fetch, validate, and cache the complete ordered OID list."""

    response = client.request_json(
        QUERY_URL,
        {
            "f": "json",
            "where": "1=1",
            "returnIdsOnly": True,
            "orderByFields": f"{OID_FIELD} ASC",
        },
        method="POST",
    )
    raw_ids = response.get("objectIds")
    if not isinstance(raw_ids, list):
        raise ArcGISError("OID query did not return objectIds.")
    try:
        oids = sorted(int(value) for value in raw_ids)
    except (TypeError, ValueError) as exc:
        raise ArcGISError("OID query returned a non-integer object ID.") from exc
    if len(oids) != len(set(oids)):
        raise ArcGISError("OID query returned duplicate object IDs.")
    payload = {
        "objectIdFieldName": response.get("objectIdFieldName", OID_FIELD),
        "count": len(oids),
        "oids": oids,
        "oidsSha256": sha256_bytes(canonical_json_bytes(oids)),
    }
    atomic_write_json(cache_dir / "oid-list.json", payload)
    return oids


def load_ordered_oids(cache_dir: Path) -> list[int]:
    payload = load_json(cache_dir / "oid-list.json")
    raw_oids = payload.get("oids")
    if not isinstance(raw_oids, list):
        raise ArcGISError("Cached OID list is missing its oids array.")
    try:
        oids = [int(value) for value in raw_oids]
    except (TypeError, ValueError) as exc:
        raise ArcGISError("Cached OID list contains a non-integer value.") from exc
    expected_hash = payload.get("oidsSha256")
    if oids != sorted(set(oids)):
        raise ArcGISError("Cached OID list is not unique and ascending.")
    if expected_hash != sha256_bytes(canonical_json_bytes(oids)):
        raise ArcGISError("Cached OID list checksum does not match its contents.")
    return oids


def _feature_oid(feature: Any) -> int:
    try:
        properties = feature["properties"]
        value = properties.get(OID_FIELD, properties.get(OID_FIELD.upper()))
        return int(value)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise ArcGISError("Downloaded feature is missing a valid objectid.") from exc


def _validate_page(
    page: JsonObject,
    *,
    expected_oids: list[int],
    path: Path,
) -> None:
    features = page.get("features")
    if page.get("type") != "FeatureCollection" or not isinstance(features, list):
        raise ArcGISError(f"{path} is not a GeoJSON FeatureCollection.")
    actual_oids = [_feature_oid(feature) for feature in features]
    if actual_oids != expected_oids:
        raise ArcGISError(
            f"{path} has unexpected OIDs: expected {expected_oids[0:3]}…"
            f"{expected_oids[-3:]}, received {actual_oids[0:3]}…{actual_oids[-3:]}."
        )


def _query_config(max_allowable_offset: float | None) -> JsonObject:
    return {
        "format": "geojson",
        "outFields": list(REQUIRED_FIELDS),
        "outSR": 4326,
        "orderByFields": f"{OID_FIELD} ASC",
        "maxAllowableOffset": max_allowable_offset,
        "allTouched": False,
    }


def _node_descriptor(
    *,
    start_index: int,
    expected_oids: list[int],
    query_sha256: str,
    parent_node_id: str | None = None,
    root_node_id: str | None = None,
    depth: int = 0,
) -> JsonObject:
    oid_sha256 = sha256_bytes(canonical_json_bytes(expected_oids))
    node_id = (
        f"oids-{start_index:09d}-{len(expected_oids):06d}-"
        f"{oid_sha256[:12]}-{query_sha256[:12]}"
    )
    return {
        "nodeId": node_id,
        "parentNodeId": parent_node_id,
        "rootNodeId": root_node_id or node_id,
        "depth": depth,
        "startIndex": start_index,
        "count": len(expected_oids),
        "firstOid": expected_oids[0],
        "lastOid": expected_oids[-1],
        "oidSha256": oid_sha256,
    }


def _node_matches_oids(node: Mapping[str, Any], oids: list[int]) -> bool:
    try:
        start = int(node["startIndex"])
        count = int(node["count"])
    except (KeyError, TypeError, ValueError):
        return False
    if start < 0 or count < 1 or start + count > len(oids):
        return False
    expected = oids[start : start + count]
    return (
        node.get("firstOid") == expected[0]
        and node.get("lastOid") == expected[-1]
        and node.get("oidSha256") == sha256_bytes(canonical_json_bytes(expected))
    )


def _leaf_path(
    cache_dir: Path,
    node: Mapping[str, Any],
    *,
    query_sha256: str,
) -> Path:
    return (
        cache_dir / "pages" / "leaves" / query_sha256[:12] / f"{node['nodeId']}.geojson"
    )


def _normalized_leaf_entry(
    *,
    node: Mapping[str, Any],
    path: Path,
    cache_dir: Path,
) -> JsonObject:
    return {
        **dict(node),
        "leafId": node["nodeId"],
        "path": str(path.relative_to(cache_dir)),
        "sha256": sha256_file(path),
    }


def _load_reusable_leaves(
    *,
    manifest: Mapping[str, Any],
    cache_dir: Path,
    oids: list[int],
    query: Mapping[str, Any],
    query_sha256: str,
) -> dict[int, JsonObject]:
    if manifest.get("query") != query:
        return {}
    entries = manifest.get("pages")
    if not isinstance(entries, list):
        return {}
    try:
        legacy_page_size = int(manifest.get("pageSize", 0))
    except (TypeError, ValueError):
        legacy_page_size = 0

    valid: list[JsonObject] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            count = int(entry["count"])
            index = int(entry.get("index", 0))
            start = int(
                entry.get(
                    "startIndex",
                    index * legacy_page_size if legacy_page_size > 0 else -1,
                )
            )
            path = cache_dir / str(entry["path"])
        except (KeyError, TypeError, ValueError):
            continue
        if start < 0 or count < 1 or start + count > len(oids) or not path.is_file():
            continue
        expected_oids = oids[start : start + count]
        expected_oid_hash = sha256_bytes(canonical_json_bytes(expected_oids))
        try:
            if (
                entry.get("firstOid") != expected_oids[0]
                or entry.get("lastOid") != expected_oids[-1]
                or entry.get("oidSha256") != expected_oid_hash
                or entry.get("sha256") != sha256_file(path)
            ):
                continue
            _validate_page(
                load_json(path),
                expected_oids=expected_oids,
                path=path,
            )
        except ArcGISError:
            continue

        node = _node_descriptor(
            start_index=start,
            expected_oids=expected_oids,
            query_sha256=query_sha256,
            parent_node_id=entry.get("parentNodeId"),
            root_node_id=entry.get("rootNodeId"),
            depth=int(entry.get("depth", 0)),
        )
        valid.append(_normalized_leaf_entry(node=node, path=path, cache_dir=cache_dir))

    valid.sort(key=lambda item: (item["startIndex"], item["count"]))
    cursor = -1
    leaves: dict[int, JsonObject] = {}
    for entry in valid:
        start = int(entry["startIndex"])
        if start < cursor:
            raise ArcGISError(
                "Cached download manifest contains overlapping valid leaf chunks."
            )
        leaves[start] = entry
        cursor = start + int(entry["count"])
    return leaves


def _load_subdivision_state(
    *,
    manifest: Mapping[str, Any],
    oids: list[int],
    query: Mapping[str, Any],
) -> tuple[dict[str, JsonObject], dict[tuple[int, int], JsonObject]]:
    subdivisions: dict[str, JsonObject] = {}
    known_nodes: dict[tuple[int, int], JsonObject] = {}
    if manifest.get("query") != query:
        return subdivisions, known_nodes
    raw_subdivisions = manifest.get("subdivisions")
    if not isinstance(raw_subdivisions, list):
        return subdivisions, known_nodes

    for raw in raw_subdivisions:
        if not isinstance(raw, dict) or not _node_matches_oids(raw, oids):
            continue
        record = dict(raw)
        children = [
            dict(child)
            for child in raw.get("children", [])
            if isinstance(child, dict) and _node_matches_oids(child, oids)
        ]
        if len(children) != 2:
            continue
        record["children"] = children
        subdivisions[str(record["nodeId"])] = record
        for node in [record, *children]:
            known_nodes[(int(node["startIndex"]), int(node["count"]))] = node
    return subdivisions, known_nodes


def _coverage_is_complete(leaves: Iterable[Mapping[str, Any]], total: int) -> bool:
    cursor = 0
    for leaf in sorted(leaves, key=lambda item: int(item["startIndex"])):
        start = int(leaf["startIndex"])
        count = int(leaf["count"])
        if start != cursor:
            return False
        cursor += count
    return cursor == total


def _request_page(
    client: ArcGISClient,
    *,
    expected_oids: list[int],
    max_allowable_offset: float | None,
) -> JsonObject:
    parameters: JsonObject = {
        "f": "geojson",
        "objectIds": ",".join(str(oid) for oid in expected_oids),
        "outFields": ",".join(REQUIRED_FIELDS),
        "returnGeometry": True,
        "outSR": 4326,
        "orderByFields": f"{OID_FIELD} ASC",
        "returnZ": False,
        "returnM": False,
    }
    if max_allowable_offset is not None:
        parameters["maxAllowableOffset"] = max_allowable_offset
        parameters["geometryPrecision"] = 8
    return client.request_json(QUERY_URL, parameters, method="POST")


def download_pages(
    client: ArcGISClient,
    *,
    oids: list[int],
    cache_dir: Path,
    page_size: int = DEFAULT_PAGE_SIZE,
    max_allowable_offset: float | None = None,
    adaptive_subdivision: bool = True,
    minimum_chunk_size: int = 1,
) -> JsonObject:
    """Download exact ordered OID leaves, subdividing only exhausted requests."""

    if not 1 <= page_size <= DEFAULT_PAGE_SIZE:
        raise ValueError(f"Page size must be between 1 and {DEFAULT_PAGE_SIZE}.")
    if not 1 <= minimum_chunk_size <= page_size:
        raise ValueError("Minimum chunk size must be between 1 and page size.")
    if max_allowable_offset is not None and max_allowable_offset <= 0:
        raise ValueError("maxAllowableOffset must be positive.")
    if oids != sorted(set(oids)):
        raise ValueError("OIDs must be unique and ascending before download.")
    pages_dir = cache_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = cache_dir / "download-manifest.json"
    manifest = load_json(manifest_path) if manifest_path.exists() else {"pages": []}
    query = _query_config(max_allowable_offset)
    query_sha256 = sha256_bytes(canonical_json_bytes(query))
    source_oid_sha256 = sha256_bytes(canonical_json_bytes(oids))
    leaves = _load_reusable_leaves(
        manifest=manifest,
        cache_dir=cache_dir,
        oids=oids,
        query=query,
        query_sha256=query_sha256,
    )
    subdivisions, known_nodes = _load_subdivision_state(
        manifest=manifest,
        oids=oids,
        query=query,
    )

    def write_manifest() -> None:
        ordered_leaves = sorted(
            leaves.values(),
            key=lambda item: int(item["startIndex"]),
        )
        for index, leaf in enumerate(ordered_leaves):
            leaf["index"] = index
        atomic_write_json(
            manifest_path,
            {
                "format": "mec-2024-arcgis-pages-v2",
                "pageSize": page_size,
                "requestedPageSize": page_size,
                "featureCount": len(oids),
                "sourceOidSha256": source_oid_sha256,
                "query": query,
                "querySha256": query_sha256,
                "adaptiveSubdivision": {
                    "enabled": adaptive_subdivision,
                    "minimumChunkSize": minimum_chunk_size,
                    "splitRule": "ordered deterministic halves; left=floor(n/2)",
                },
                "coveredFeatureCount": sum(
                    int(leaf["count"]) for leaf in ordered_leaves
                ),
                "complete": _coverage_is_complete(ordered_leaves, len(oids)),
                "pages": ordered_leaves,
                "subdivisions": sorted(
                    subdivisions.values(),
                    key=lambda item: (
                        int(item["startIndex"]),
                        int(item["depth"]),
                        -int(item["count"]),
                    ),
                ),
            },
        )

    def terminal_error(
        node: Mapping[str, Any],
        error: ArcGISRequestExhaustedError,
    ) -> ArcGISError:
        start = int(node["startIndex"])
        count = int(node["count"])
        failed_oids = oids[start : start + count]
        oid_context = (
            f"OID {failed_oids[0]}"
            if count == 1
            else f"OIDs {failed_oids[0]}–{failed_oids[-1]} ({count} OIDs)"
        )
        stop_reason = (
            "adaptive subdivision is disabled"
            if not adaptive_subdivision
            else f"the configured minimum chunk size ({minimum_chunk_size}) was reached"
        )
        return ArcGISError(
            f"Persistent exact ArcGIS page failure after {stop_reason}: "
            f"{oid_context}; node={node['nodeId']}; "
            f"parent={node.get('parentNodeId')}; root={node['rootNodeId']}; "
            f"cache={cache_dir}; failure={error.as_record()}."
        )

    def download_node(node: JsonObject) -> None:
        start = int(node["startIndex"])
        count = int(node["count"])
        existing = leaves.get(start)
        if existing is not None and int(existing["count"]) == count:
            return
        expected_oids = oids[start : start + count]
        page_path = _leaf_path(
            cache_dir,
            node,
            query_sha256=query_sha256,
        )
        try:
            page = _request_page(
                client,
                expected_oids=expected_oids,
                max_allowable_offset=max_allowable_offset,
            )
        except ArcGISRequestExhaustedError as exc:
            if not adaptive_subdivision or count <= minimum_chunk_size:
                raise terminal_error(node, exc) from exc

            midpoint = count // 2
            left_oids = expected_oids[:midpoint]
            right_oids = expected_oids[midpoint:]
            left = _node_descriptor(
                start_index=start,
                expected_oids=left_oids,
                query_sha256=query_sha256,
                parent_node_id=str(node["nodeId"]),
                root_node_id=str(node["rootNodeId"]),
                depth=int(node["depth"]) + 1,
            )
            right = _node_descriptor(
                start_index=start + midpoint,
                expected_oids=right_oids,
                query_sha256=query_sha256,
                parent_node_id=str(node["nodeId"]),
                root_node_id=str(node["rootNodeId"]),
                depth=int(node["depth"]) + 1,
            )
            subdivisions[str(node["nodeId"])] = {
                **node,
                "failure": exc.as_record(),
                "children": [left, right],
            }
            known_nodes[(start, midpoint)] = left
            known_nodes[(start + midpoint, count - midpoint)] = right
            write_manifest()
            download_node(left)
            download_node(right)
            return

        features = page.get("features")
        if isinstance(features, list):
            features.sort(key=_feature_oid)
        _validate_page(page, expected_oids=expected_oids, path=page_path)
        atomic_write_json(page_path, page)
        leaves[start] = _normalized_leaf_entry(
            node=node,
            path=page_path,
            cache_dir=cache_dir,
        )
        write_manifest()

    write_manifest()
    cursor = 0
    while cursor < len(oids):
        existing = leaves.get(cursor)
        if existing is not None:
            cursor += int(existing["count"])
            continue
        later_starts = [start for start in leaves if start > cursor]
        boundary = min(later_starts, default=len(oids))
        candidates = [
            node
            for (start, count), node in known_nodes.items()
            if start == cursor and cursor + count <= boundary
        ]
        if candidates:
            node = min(candidates, key=lambda item: int(item["count"]))
        else:
            count = min(page_size, boundary - cursor)
            node = _node_descriptor(
                start_index=cursor,
                expected_oids=oids[cursor : cursor + count],
                query_sha256=query_sha256,
            )
        download_node(dict(node))
        cursor += int(node["count"])

    write_manifest()
    completed = load_json(manifest_path)
    if not completed.get("complete"):
        raise ArcGISError(
            "Download finished without exactly-once coverage of the ordered OID list."
        )
    return completed


def page_paths(cache_dir: Path) -> list[Path]:
    manifest = load_json(cache_dir / "download-manifest.json")
    entries = manifest.get("pages")
    if not isinstance(entries, list) or not entries:
        raise ArcGISError("Download manifest has no pages.")
    oids = load_ordered_oids(cache_dir)
    if manifest.get("sourceOidSha256") != sha256_bytes(canonical_json_bytes(oids)):
        raise ArcGISError(
            "Download manifest does not match the cached ordered OID list."
        )
    if manifest.get("featureCount") != len(oids) or manifest.get(
        "coveredFeatureCount"
    ) != len(oids):
        raise ArcGISError(
            "Download manifest feature totals do not prove complete OID coverage."
        )
    if not manifest.get("complete"):
        raise ArcGISError("Download manifest is incomplete.")

    ordered_entries = sorted(entries, key=lambda entry: int(entry["startIndex"]))
    paths: list[Path] = []
    cursor = 0
    for index, entry in enumerate(ordered_entries):
        try:
            start = int(entry["startIndex"])
            count = int(entry["count"])
            path = cache_dir / str(entry["path"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ArcGISError(f"Download manifest leaf {index} is malformed.") from exc
        if start != cursor or count < 1 or start + count > len(oids):
            raise ArcGISError(
                f"Download manifest has an OID gap, duplicate, or overlap at leaf {index}."
            )
        expected_oids = oids[start : start + count]
        if not path.is_file():
            raise ArcGISError(f"Downloaded page is missing: {path}")
        if sha256_file(path) != entry.get("sha256"):
            raise ArcGISError(f"Downloaded page checksum is invalid: {path}")
        expected_oid_hash = sha256_bytes(canonical_json_bytes(expected_oids))
        if (
            entry.get("index") != index
            or entry.get("firstOid") != expected_oids[0]
            or entry.get("lastOid") != expected_oids[-1]
            or entry.get("oidSha256") != expected_oid_hash
        ):
            raise ArcGISError(
                f"Download manifest OID metadata is invalid for page {index}."
            )
        _validate_page(
            load_json(path),
            expected_oids=expected_oids,
            path=path,
        )
        paths.append(path)
        cursor += count
    if cursor != len(oids):
        raise ArcGISError(
            "Download manifest does not cover the complete ordered OID list."
        )
    return paths
