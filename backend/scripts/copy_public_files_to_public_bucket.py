"""Copy public Vercel Blob files into the public GCS bucket.

Streams each object from the source host into Cloud Storage. Nothing is written
to a local data file. Re-running is safe: a destination object whose size
already matches the source Content-Length is skipped, and only its
Content-Disposition is corrected when it differs.

Files copied: the stage-A catalog closure, the species files listed by each
species manifest it names, the batch manifests of the runtime catalog index,
and EXTRA_PATHS.

Object names are urllib.parse.unquote of the URL path. This is not
unquote_plus, so a literal plus sign stays a plus sign.

Usage: python copy_public_files_to_public_bucket.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import requests
import urllib3
from google.api_core import exceptions as google_exceptions
from google.auth.exceptions import RefreshError, TransportError
from google.cloud import storage
from google.resumable_media.common import DataCorruption, InvalidResponse

SOURCE_HOST = "https://aagibolq28slyfof.public.blob.vercel-storage.com"
BUCKET_NAME = "pnn-priorizando-la-naturaleza-public"
DEST_PREFIX = f"https://storage.googleapis.com/{BUCKET_NAME}/"
CATALOG_INDEX_PATH = (
    "catalog-releases/3.7.1-test-site-stage-a/catalog-release-index.json"
)
RUNTIME_CATALOG_INDEX_PATH = "catalog-releases/3.7.1/catalog-release-index.json"
USER_GUIDE_PREFIX = "docs/user-guides/"
CREDENTIALS_PATH = (
    Path(__file__).resolve().parents[1]
    / "secrets"
    / "pnn-priorizando-la-naturaleza_service_account_key.json"
)

WORKERS = 4
CHUNK_SIZE = 8 * 1024 * 1024
MISSING_ATTEMPTS = 2
TRANSIENT_ATTEMPTS = 5  # first try plus 4 retries
CONSECUTIVE_FAILURE_LIMIT = 12
PROGRESS_EVERY = 25
HEARTBEAT_SECONDS = 60

EXTRA_PATHS = [
    "catalog-releases/3.7.1/catalog-release-index.json",
    "catalog-releases/3.7.1-test-site-stage-a/catalog-release-index.json",
    "manifest/manifest.json",
    "inputs/features/species/biomod_spp_ranges_updatedIUCN.csv",
    "inputs/includes/runap_identify.geojson",
    "inputs/includes/omecs_identify.geojson",
    "inputs/features/ecosystems/ecosistemas_IDs_IAVH_2024.csv",
    "inputs/features/ecosystems/ecosystem-classification-summary.json",
    "inputs/reference/colombia_outline_visual/v0.1.0/colombia_outline_visual.geojson",
    "docs/user-guides/en/user-guide.mp4",
    "docs/user-guides/en/poster.jpg",
    "docs/user-guides/en/user-guide.pdf",
    "docs/user-guides/es/user-guide.mp4",
    "docs/user-guides/es/poster.jpg",
    "docs/user-guides/es/user-guide.pdf",
    "releases/sirap-2026-08-31-v3/catalog.json",
    "inputs/features/biomass/biomasa_areara+subterranea_1km.tif",
    "inputs/boundaries/sirap/siraps_merged_polygon_v2.geojson",
    "inputs/boundaries/sirap/siraps_territorial_authoritative_v3.geojson",
    "inputs/boundaries/sirap/v1/sha256-183dce77b1695649926c91d2fd1f6ed4b973cc336c3816035b4c91dccd9e6149/siraps_marine_caribe_pacifico_v1.geojson",
    "boundaries/igac_departments_detailed.geojson",
    "boundaries/igac_municipalities_detailed.geojson",
]

PRIORITY_PATHS = [
    CATALOG_INDEX_PATH,
    "inputs/reference/colombia_outline_visual/v0.1.0/colombia_outline_visual.geojson",
    "inputs/features/biomass/biomasa_areara+subterranea_1km.tif",
]

CONTENT_TYPES = {
    ".json": "application/json",
    ".geojson": "application/geo+json",
    ".csv": "text/csv",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".gz": "application/gzip",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

LOG_DIR = Path(tempfile.gettempdir()) / "dmt-public-bucket-copy"
LOG_PATH = LOG_DIR / "copy.log"
STATUS_PATH = LOG_DIR / "status.json"
SUMMARY_PATH = LOG_DIR / "summary.json"
KEYS_PATH = LOG_DIR / "keys.txt"

logger = logging.getLogger("copy_public_files")


class SourceMissing(Exception):
    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


class TransientError(Exception):
    pass


class PermanentCopyError(Exception):
    pass


class UtcFormatter(logging.Formatter):
    converter = time.gmtime


def safe_error(exc: BaseException) -> str:
    text = f"{type(exc).__name__}: {exc}".replace("\n", " ").replace("\r", " ")
    if "PRIVATE KEY" in text or "private_key" in text:
        return f"{type(exc).__name__}: credentials error (details omitted)"
    return text[:400]


def sleep_backoff(attempt: int) -> None:
    base = min(2**attempt, 32)
    time.sleep(base + random.random())


def source_url_for_path(path: str) -> str:
    return SOURCE_HOST + "/" + path.lstrip("/")


def object_name_from_url(url: str) -> str:
    """Return the GCS object name for a source URL.

    unquote keeps a literal '+' . unquote_plus would turn that plus into a space
    and break names such as biomasa_areara+subterranea_1km.tif.
    """

    return unquote(urlparse(url).path.lstrip("/"))


def public_object_url(name: str) -> str:
    return DEST_PREFIX + quote(name, safe="/+")


def is_file_object_name(name: str) -> bool:
    return bool(name) and not name.endswith("/")


def guess_content_type(name: str) -> str:
    suffix = Path(name).suffix.lower()
    return CONTENT_TYPES.get(suffix, "application/octet-stream")


def choose_content_type(header_value: str | None, name: str) -> str:
    if header_value and header_value.strip():
        return header_value.split(",")[0].strip()
    return guess_content_type(name)


def download_disposition(name: str, source_disposition: str | None) -> str | None:
    """The Content-Disposition the public object should carry.

    Only Vercel's `attachment` is kept: GCS without the header already behaves
    like `inline`. The user-guide PDFs are linked only from Download buttons,
    which relied on Vercel's `?download=1`, so they are always `attachment`.
    """
    if name.startswith(USER_GUIDE_PREFIX) and name.endswith(".pdf"):
        return f'attachment; filename="{Path(name).name}"'
    value = (source_disposition or "").strip()
    return value if value.lower().startswith("attachment") else None


def content_length_of(headers) -> int | None:
    raw = headers.get("Content-Length")
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    return int(text)


def collect_source_urls(document, found: set[str]) -> None:
    if isinstance(document, str):
        value = document.strip()
        if value.startswith(SOURCE_HOST):
            found.add(value.split("#", 1)[0].split("?", 1)[0])
        return
    if isinstance(document, dict):
        for value in document.values():
            collect_source_urls(value, found)
        return
    if isinstance(document, list):
        for value in document:
            collect_source_urls(value, found)


def collect_species_manifest_urls(document, found: set[str]) -> None:
    if isinstance(document, dict):
        for key, value in document.items():
            if key == "speciesManifestUrl" and isinstance(value, str):
                url = value.strip()
                if url.startswith(SOURCE_HOST):
                    found.add(url.split("#", 1)[0].split("?", 1)[0])
            else:
                collect_species_manifest_urls(value, found)
        return
    if isinstance(document, list):
        for value in document:
            collect_species_manifest_urls(value, found)


def make_session() -> requests.Session:
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=8,
        pool_maxsize=8,
        max_retries=0,
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(
        {
            "Accept-Encoding": "identity",
            "User-Agent": "dmt-public-bucket-copy",
        }
    )
    return session


def configure_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    logger.propagate = False
    handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
    handler.setFormatter(
        UtcFormatter("%(asctime)sZ %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%S")
    )
    logger.addHandler(handler)


def emit(message: str) -> None:
    print(message, flush=True)
    logger.info(message)


class CopyProgress:
    def __init__(self, total: int):
        self.total = total
        self.copied = 0
        self.skipped = 0
        self.failed = 0
        self.missing = 0
        self.copied_bytes = 0
        self.skipped_bytes = 0
        self.read_bytes = 0
        self.last_key = ""
        self.inflight: set[str] = set()
        self.failures: list[dict[str, str]] = []
        self.missing_keys: list[dict[str, str]] = []
        self.dropped: list[str] = []
        self.fatal = ""
        self.phase = "start"
        self.consecutive_failures = 0
        self.tif_sample: tuple[str, str, int] | None = None
        self.json_sample: tuple[str, str, int] | None = None
        self.json_sample_is_compact = False
        self.started = time.time()
        self.lock = threading.RLock()

    def set_phase(self, phase: str) -> None:
        with self.lock:
            self.phase = phase
            self.write_status()

    def set_fatal(self, reason: str) -> None:
        with self.lock:
            if not self.fatal:
                self.fatal = reason
                logger.error("fatal %s", reason)
                self.write_status()

    def note_read(self, count: int) -> None:
        if count <= 0:
            return
        with self.lock:
            self.read_bytes += count

    def begin(self, name: str) -> None:
        with self.lock:
            self.inflight.add(name)

    def end_inflight(self, name: str) -> None:
        with self.lock:
            self.inflight.discard(name)

    def finish(
        self,
        name: str,
        outcome: str,
        nbytes: int,
        detail: str,
    ) -> None:
        with self.lock:
            self.inflight.discard(name)
            self.last_key = name
            if outcome == "copied":
                self.copied += 1
                self.copied_bytes += nbytes
                self.consecutive_failures = 0
                logger.info("copied bytes=%s %s key=%s", nbytes, detail, name)
            elif outcome == "skipped":
                self.skipped += 1
                self.skipped_bytes += nbytes
                self.consecutive_failures = 0
                logger.info("skipped bytes=%s key=%s", nbytes, name)
            elif outcome == "missing":
                self.missing += 1
                self.missing_keys.append({"key": name, "error": detail})
                self.consecutive_failures = 0
                logger.info("missing %s key=%s", detail, name)
            else:
                self.failed += 1
                self.failures.append({"key": name, "error": detail})
                self.consecutive_failures += 1
                logger.error("failed %s key=%s", detail, name)
                if self.consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT and not self.fatal:
                    self.fatal = (
                        f"{CONSECUTIVE_FAILURE_LIMIT} consecutive copy failures"
                    )
                    logger.error("fatal %s", self.fatal)
            done = self.copied + self.skipped + self.failed + self.missing
            if done % PROGRESS_EVERY == 0 or done == self.total:
                self.print_progress(done)
            self.write_status()

    def consider_sample(self, name: str, url: str, nbytes: int) -> None:
        with self.lock:
            if name.endswith((".tif", ".tiff")):
                preferred = name.endswith("biomasa_areara+subterranea_1km.tif")
                if self.tif_sample is None or preferred:
                    self.tif_sample = (name, url, nbytes)
            compact = name.endswith(".metrics.compact.json")
            metrics = compact or name.endswith(".metrics.json")
            if metrics and (
                self.json_sample is None
                or (compact and not self.json_sample_is_compact)
            ):
                self.json_sample = (name, url, nbytes)
                self.json_sample_is_compact = compact

    def print_progress(self, done: int) -> None:
        message = (
            f"done={done} skipped={self.skipped} failed={self.failed} "
            f"copied={self.copied} missing={self.missing} bytes={self.copied_bytes} "
            f"last={self.last_key}"
        )
        print(message, flush=True)
        logger.info(message)

    def heartbeat(self) -> None:
        with self.lock:
            done = self.copied + self.skipped + self.failed + self.missing
            inflight = ",".join(sorted(self.inflight)) or "-"
            message = (
                f"heartbeat phase={self.phase} done={done}/{self.total} "
                f"copied={self.copied} skipped={self.skipped} failed={self.failed} "
                f"missing={self.missing} bytes={self.copied_bytes} "
                f"read_bytes={self.read_bytes} last={self.last_key or '-'} "
                f"inflight={inflight}"
            )
            print(message, flush=True)
            logger.info(message)
            self.write_status()

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            done = self.copied + self.skipped + self.failed + self.missing
            return {
                "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "phase": self.phase,
                "total": self.total,
                "done": done,
                "copied": self.copied,
                "skipped": self.skipped,
                "failed": self.failed,
                "missing": self.missing,
                "bytes": self.copied_bytes,
                "skipped_bytes": self.skipped_bytes,
                "read_bytes": self.read_bytes,
                "last": self.last_key,
                "inflight": sorted(self.inflight),
                "fatal": self.fatal,
                "elapsed_seconds": round(time.time() - self.started, 1),
                "failures": self.failures[:15],
                "missing_keys": self.missing_keys,
                "dropped": self.dropped,
            }

    def write_status(self) -> None:
        payload = {
            "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "phase": self.phase,
            "total": self.total,
            "done": self.copied + self.skipped + self.failed + self.missing,
            "copied": self.copied,
            "skipped": self.skipped,
            "failed": self.failed,
            "missing": self.missing,
            "bytes": self.copied_bytes,
            "skipped_bytes": self.skipped_bytes,
            "read_bytes": self.read_bytes,
            "last": self.last_key,
            "inflight": sorted(self.inflight),
            "fatal": self.fatal,
            "elapsed_seconds": round(time.time() - self.started, 1),
            "failures": self.failures[:15],
            "missing_count": len(self.missing_keys),
        }
        temporary = STATUS_PATH.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload), encoding="utf-8")
        temporary.replace(STATUS_PATH)


class ByteStream:
    """File-like body that reports tell() so resumable uploads can stream."""

    def __init__(self, raw, on_read):
        self._raw = raw
        self._pos = 0
        self._on_read = on_read

    def tell(self) -> int:
        return self._pos

    def read(self, size: int = -1) -> bytes:
        if size == 0:
            return b""
        if size is None or size < 0:
            chunks: list[bytes] = []
            while True:
                piece = self._raw.read(1024 * 1024)
                if not piece:
                    break
                chunks.append(piece)
            data = b"".join(chunks)
        else:
            chunks = []
            remaining = size
            while remaining > 0:
                piece = self._raw.read(remaining)
                if not piece:
                    break
                chunks.append(piece)
                remaining -= len(piece)
            data = b"".join(chunks)
        self._pos += len(data)
        if data:
            self._on_read(len(data))
        return data


class BucketCopy:
    def __init__(
        self,
        progress: CopyProgress,
        dest_sizes: dict[str, int],
        dest_dispositions: dict[str, str | None],
    ):
        self.progress = progress
        self.dest_sizes = dest_sizes
        self.dest_dispositions = dest_dispositions
        self._local = threading.local()

    def session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = make_session()
            self._local.session = session
        return session

    def bucket(self):
        bucket = getattr(self._local, "bucket", None)
        if bucket is None:
            client = storage.Client.from_service_account_json(str(CREDENTIALS_PATH))
            bucket = client.bucket(BUCKET_NAME)
            self._local.bucket = bucket
        return bucket

    def copy_object(self, name: str, url: str) -> str:
        if self.progress.fatal:
            return "cancelled"
        self.progress.begin(name)
        missing_tries = 0
        transient_tries = 0
        try:
            while True:
                if self.progress.fatal:
                    return "cancelled"
                try:
                    outcome, nbytes, detail = self._attempt(name, url)
                except SourceMissing as exc:
                    missing_tries += 1
                    if missing_tries >= MISSING_ATTEMPTS:
                        self.progress.finish(name, "missing", 0, str(exc))
                        return "missing"
                    sleep_backoff(missing_tries)
                    continue
                except TransientError as exc:
                    transient_tries += 1
                    logger.warning(
                        "transient attempt=%s key=%s error=%s",
                        transient_tries,
                        name,
                        safe_error(exc),
                    )
                    if transient_tries >= TRANSIENT_ATTEMPTS:
                        self.progress.finish(name, "failed", 0, safe_error(exc))
                        return "failed"
                    sleep_backoff(transient_tries)
                    continue
                except PermanentCopyError as exc:
                    self.progress.finish(name, "failed", 0, safe_error(exc))
                    return "failed"
                except RefreshError as exc:
                    self.progress.set_fatal("credentials were rejected")
                    self.progress.finish(name, "failed", 0, "credentials were rejected")
                    logger.error("credentials rejected class=%s", type(exc).__name__)
                    return "failed"
                self.progress.finish(name, outcome, nbytes, detail)
                if outcome in ("copied", "skipped"):
                    self.progress.consider_sample(name, url, nbytes)
                return outcome
        finally:
            self.progress.end_inflight(name)

    def _attempt(self, name: str, url: str) -> tuple[str, int, str]:
        try:
            return self._attempt_once(name, url)
        except (SourceMissing, TransientError, PermanentCopyError, RefreshError):
            raise
        except InvalidResponse as exc:
            raise classify_invalid_response(exc) from exc
        except DataCorruption as exc:
            raise TransientError(safe_error(exc)) from exc
        except google_exceptions.GoogleAPICallError as exc:
            raise classify_google_error(exc) from exc
        except TransportError as exc:
            raise TransientError(safe_error(exc)) from exc
        except (
            requests.exceptions.RequestException,
            urllib3.exceptions.HTTPError,
            TimeoutError,
            ConnectionError,
            OSError,
        ) as exc:
            raise TransientError(safe_error(exc)) from exc
        except ValueError as exc:
            text = str(exc)
            if any(
                phrase in text
                for phrase in ("less than", "exhausted", "beginning", "remaining")
            ):
                raise TransientError(safe_error(exc)) from exc
            raise PermanentCopyError(safe_error(exc)) from exc

    def _attempt_once(self, name: str, url: str) -> tuple[str, int, str]:
        session = self.session()
        length, content_type, source_disposition = self._source_metadata(session, url)
        disposition = download_disposition(name, source_disposition)
        with self.progress.lock:
            existing = self.dest_sizes.get(name)
            existing_disposition = self.dest_dispositions.get(name)
        if existing is not None and existing == length:
            if disposition != existing_disposition:
                self._patch_disposition(name, disposition)
            return "skipped", length, content_type or ""
        response = self._open_body(session, url)
        try:
            body_length = content_length_of(response.headers)
            if body_length is None:
                raise PermanentCopyError("GET response has no Content-Length")
            encoding = response.headers.get("Content-Encoding", "").strip().lower()
            if encoding and encoding != "identity":
                raise PermanentCopyError(
                    f"source Content-Encoding was {encoding}, expected identity"
                )
            chosen = choose_content_type(
                content_type or response.headers.get("Content-Type"),
                name,
            )
            self._upload(name, response, body_length, chosen, disposition)
            return "copied", body_length, chosen
        finally:
            response.close()

    def _patch_disposition(self, name: str, disposition: str | None) -> None:
        blob = self.bucket().blob(name)
        blob.content_disposition = disposition
        blob.patch(timeout=120)
        with self.progress.lock:
            self.dest_dispositions[name] = disposition
        logger.info("patched disposition=%s key=%s", disposition, name)

    def _source_metadata(
        self, session: requests.Session, url: str
    ) -> tuple[int, str | None, str | None]:
        response = self._request(session, "HEAD", url, stream=False)
        try:
            status = response.status_code
            if status in (404, 410):
                raise SourceMissing(status)
            if status in (408, 429) or status >= 500:
                raise TransientError(f"HEAD HTTP {status}")
            if status in (400, 405):
                # Some edges reject HEAD. The GET below decides missing vs copy.
                return self._metadata_from_get(session, url)
            if status >= 400:
                raise PermanentCopyError(f"HEAD HTTP {status}")
            length = content_length_of(response.headers)
            content_type = response.headers.get("Content-Type")
            if length is None:
                return self._metadata_from_get(session, url)
            return length, content_type, response.headers.get("Content-Disposition")
        finally:
            response.close()

    def _metadata_from_get(
        self, session: requests.Session, url: str
    ) -> tuple[int, str | None, str | None]:
        response = self._open_body(session, url)
        try:
            length = content_length_of(response.headers)
            if length is None:
                raise PermanentCopyError("source response has no Content-Length")
            return (
                length,
                response.headers.get("Content-Type"),
                response.headers.get("Content-Disposition"),
            )
        finally:
            response.close()

    def _open_body(self, session: requests.Session, url: str) -> requests.Response:
        response = self._request(session, "GET", url, stream=True)
        status = response.status_code
        if status in (404, 410):
            response.close()
            raise SourceMissing(status)
        if status in (408, 429) or status >= 500:
            response.close()
            raise TransientError(f"GET HTTP {status}")
        if status >= 400:
            response.close()
            raise PermanentCopyError(f"GET HTTP {status}")
        response.raw.decode_content = False
        return response

    def _request(
        self,
        session: requests.Session,
        method: str,
        url: str,
        *,
        stream: bool,
    ) -> requests.Response:
        try:
            return session.request(
                method,
                url,
                timeout=(30, 1200),
                stream=stream,
                allow_redirects=True,
            )
        except (
            requests.exceptions.RequestException,
            urllib3.exceptions.HTTPError,
            TimeoutError,
            ConnectionError,
            OSError,
        ) as exc:
            raise TransientError(safe_error(exc)) from exc

    def _upload(
        self,
        name: str,
        response: requests.Response,
        size: int,
        content_type: str,
        disposition: str | None,
    ) -> None:
        stream = ByteStream(response.raw, self.progress.note_read)
        blob = self.bucket().blob(name)
        blob.chunk_size = CHUNK_SIZE
        if disposition:
            blob.content_disposition = disposition
        try:
            blob.upload_from_file(
                stream,
                rewind=False,
                size=size,
                content_type=content_type,
                timeout=300,
                checksum="auto",
            )
        except google_exceptions.BadRequest:
            base_type = content_type.split(";", 1)[0].strip()
            if not base_type or base_type == content_type:
                raise
            logger.warning(
                "retrying upload with media type only key=%s type=%s",
                name,
                base_type,
            )
            # The first attempt already consumed the body. Ask the caller to retry.
            raise TransientError(f"content type rejected: {content_type}")
        uploaded = blob.size
        if uploaded is None or int(uploaded) != size:
            blob.reload(timeout=120)
            uploaded = blob.size
        if uploaded is None or int(uploaded) != size:
            raise TransientError(f"uploaded size {uploaded} != source {size}")
        with self.progress.lock:
            self.dest_sizes[name] = int(uploaded)
            self.dest_dispositions[name] = disposition


def classify_google_error(exc: google_exceptions.GoogleAPICallError) -> Exception:
    code = getattr(exc, "code", None)
    if code in (408, 429) or (isinstance(code, int) and code >= 500):
        return TransientError(safe_error(exc))
    if isinstance(
        exc,
        (
            google_exceptions.TooManyRequests,
            google_exceptions.ServiceUnavailable,
            google_exceptions.InternalServerError,
            google_exceptions.BadGateway,
            google_exceptions.GatewayTimeout,
            google_exceptions.DeadlineExceeded,
        ),
    ):
        return TransientError(safe_error(exc))
    return PermanentCopyError(safe_error(exc))


def classify_invalid_response(exc: InvalidResponse) -> Exception:
    response = getattr(exc, "response", None)
    code = getattr(response, "status_code", None)
    if code in (408, 429) or (isinstance(code, int) and code >= 500):
        return TransientError(safe_error(exc))
    return PermanentCopyError(safe_error(exc))


def fetch_json(session: requests.Session, url: str):
    last_error: Exception | None = None
    for attempt in range(1, TRANSIENT_ATTEMPTS + 1):
        try:
            response = session.get(url, timeout=(30, 600), allow_redirects=True)
        except (
            requests.exceptions.RequestException,
            urllib3.exceptions.HTTPError,
            TimeoutError,
            ConnectionError,
            OSError,
        ) as exc:
            last_error = exc
            if attempt >= TRANSIENT_ATTEMPTS:
                raise PermanentCopyError(safe_error(exc)) from exc
            sleep_backoff(attempt)
            continue
        try:
            status = response.status_code
            if status in (404, 410):
                raise PermanentCopyError(f"catalog JSON missing HTTP {status} {url}")
            if status in (408, 429) or status >= 500:
                last_error = PermanentCopyError(f"HTTP {status}")
                if attempt >= TRANSIENT_ATTEMPTS:
                    raise PermanentCopyError(f"catalog JSON HTTP {status} {url}")
                sleep_backoff(attempt)
                continue
            if status >= 400:
                raise PermanentCopyError(f"catalog JSON HTTP {status} {url}")
            return response.json()
        finally:
            response.close()
    raise PermanentCopyError(safe_error(last_error or RuntimeError("catalog JSON failed")))


def build_work_items(session: requests.Session) -> tuple[dict[str, str], list[str]]:
    index_url = source_url_for_path(CATALOG_INDEX_PATH)
    index_document = fetch_json(session, index_url)
    discovered: set[str] = set()
    collect_source_urls(index_document, discovered)
    manifest_urls = sorted(
        url for url in discovered if urlparse(url).path.lower().endswith(".json")
    )
    emit(
        f"discovery index_urls={len(discovered)} json_manifests={len(manifest_urls)}"
    )
    species_manifest_urls: set[str] = set()
    for manifest_url in manifest_urls:
        document = fetch_json(session, manifest_url)
        before = len(discovered)
        collect_source_urls(document, discovered)
        collect_species_manifest_urls(document, species_manifest_urls)
        emit(
            "discovery walked="
            f"{object_name_from_url(manifest_url)} added={len(discovered) - before} "
            f"total={len(discovered)}"
        )
    for species_manifest_url in sorted(species_manifest_urls):
        before = len(discovered)
        collect_source_urls(fetch_json(session, species_manifest_url), discovered)
        emit(
            "discovery walked species manifest="
            f"{object_name_from_url(species_manifest_url)} "
            f"added={len(discovered) - before} total={len(discovered)}"
        )

    runtime_index_urls: set[str] = set()
    collect_source_urls(
        fetch_json(session, source_url_for_path(RUNTIME_CATALOG_INDEX_PATH)),
        runtime_index_urls,
    )
    # Copied but never walked: these manifests name regional files that must stay
    # off the public bucket.
    runtime_manifest_urls = {
        url for url in runtime_index_urls if urlparse(url).path.lower().endswith(".json")
    }
    emit(f"discovery runtime_manifests={sorted(runtime_manifest_urls)}")
    discovered.update(runtime_manifest_urls)

    by_name: dict[str, str] = {}
    dropped: list[str] = []
    for url in sorted(discovered):
        name = object_name_from_url(url)
        if not is_file_object_name(name):
            dropped.append(name or "(empty path)")
            continue
        by_name.setdefault(name, url)
    for path in EXTRA_PATHS:
        name = unquote(path.lstrip("/"))
        if not is_file_object_name(name):
            dropped.append(name or path)
            continue
        by_name.setdefault(name, source_url_for_path(path))
    return by_name, dropped


def load_destination_state() -> tuple[dict[str, int], dict[str, str | None]]:
    client = storage.Client.from_service_account_json(str(CREDENTIALS_PATH))
    sizes: dict[str, int] = {}
    dispositions: dict[str, str | None] = {}
    for blob in client.list_blobs(BUCKET_NAME, timeout=300):
        if blob.size is not None:
            sizes[blob.name] = int(blob.size)
            dispositions[blob.name] = blob.content_disposition
    return sizes, dispositions


def assert_anonymous(request: urllib.request.Request) -> None:
    names = {name.lower() for name, _value in request.header_items()}
    if "authorization" in names:
        raise RuntimeError("anonymous verification request included Authorization")


def anonymous_exchange(
    url: str,
    *,
    method: str = "GET",
    read_limit: int | None = 64,
) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept-Encoding": "identity",
            "User-Agent": "dmt-public-bucket-copy",
        },
        method=method,
    )
    assert_anonymous(request)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            if read_limit is None:
                body = response.read()
            elif read_limit > 0:
                body = response.read(read_limit)
            else:
                body = b""
            return {
                "status": response.status,
                "content_length": response.headers.get("Content-Length"),
                "content_type": response.headers.get("Content-Type"),
                "body": body,
                "error": "",
            }
    except urllib.error.HTTPError as exc:
        body = b""
        try:
            if read_limit is None:
                body = exc.read()
        finally:
            exc.close()
        return {
            "status": exc.code,
            "content_length": exc.headers.get("Content-Length") if exc.headers else None,
            "content_type": exc.headers.get("Content-Type") if exc.headers else None,
            "body": body,
            "error": safe_error(exc),
        }
    except urllib.error.URLError as exc:
        return {
            "status": 0,
            "content_length": None,
            "content_type": None,
            "body": b"",
            "error": safe_error(exc),
        }


def verify_index() -> dict[str, object]:
    url = public_object_url(CATALOG_INDEX_PATH)
    result = anonymous_exchange(url, method="GET", read_limit=None)
    batches = False
    parse_error = ""
    body = result["body"]
    if result["status"] == 200 and isinstance(body, bytes):
        try:
            document = json.loads(body.decode("utf-8"))
            batches = isinstance(document, dict) and "batches" in document
        except json.JSONDecodeError as exc:
            parse_error = safe_error(exc)
    return {
        "url": url,
        "status": result["status"],
        "batches": batches,
        "content_length": result["content_length"],
        "error": result["error"] or parse_error,
        "ok": result["status"] == 200 and batches,
    }


def verify_public_get(name: str) -> dict[str, object]:
    url = public_object_url(name)
    result = anonymous_exchange(url, method="GET", read_limit=64)
    return {
        "name": name,
        "url": url,
        "status": result["status"],
        "content_length": result["content_length"],
        "content_type": result["content_type"],
        "error": result["error"],
        "ok": result["status"] == 200,
    }


def verify_length_match(name: str, source_url: str) -> dict[str, object]:
    source = anonymous_exchange(source_url, method="HEAD", read_limit=0)
    if source["status"] != 200 or not source["content_length"]:
        source = anonymous_exchange(source_url, method="GET", read_limit=64)
    dest = verify_public_get(name)
    source_length = source["content_length"]
    dest_length = dest["content_length"]
    match = (
        dest["status"] == 200
        and source_length is not None
        and dest_length is not None
        and int(str(source_length)) == int(str(dest_length))
    )
    return {
        "name": name,
        "source_url": source_url,
        "dest_status": dest["status"],
        "source_status": source["status"],
        "source_length": None if source_length is None else int(str(source_length)),
        "dest_length": None if dest_length is None else int(str(dest_length)),
        "match": match,
        "error": dest["error"] or source["error"],
    }


def ordered_names(by_name: dict[str, str]) -> list[str]:
    priority = [path for path in PRIORITY_PATHS if path in by_name]
    rest = sorted(name for name in by_name if name not in priority)
    return priority + rest


def copy_all(copier: BucketCopy, by_name: dict[str, str]) -> bool:
    names = ordered_names(by_name)
    priority = [name for name in PRIORITY_PATHS if name in by_name]
    for name in priority:
        outcome = copier.copy_object(name, by_name[name])
        if outcome not in ("copied", "skipped"):
            copier.progress.set_fatal(f"priority object {outcome}: {name}")
            return False
    index_check = {"ok": False, "status": 0, "batches": False}
    outline = {"ok": False, "status": 0}
    for attempt in range(1, 6):
        index_check = verify_index()
        outline = verify_public_get(
            "inputs/reference/colombia_outline_visual/v0.1.0/colombia_outline_visual.geojson"
        )
        emit(
            "early-verify "
            f"attempt={attempt} index_status={index_check['status']} "
            f"batches={index_check['batches']} geojson_status={outline['status']}"
        )
        if index_check["ok"] and outline["ok"]:
            break
        sleep_backoff(attempt)
    if not index_check["ok"]:
        copier.progress.set_fatal("anonymous catalog index check failed")
        return False
    if not outline["ok"]:
        copier.progress.set_fatal("anonymous outline check failed")
        return False

    remaining = [name for name in names if name not in priority]
    if not remaining:
        return True
    workers = min(WORKERS, len(remaining))
    emit(f"bulk_start count={len(remaining)} workers={workers}")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(copier.copy_object, name, by_name[name]) for name in remaining
        ]
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as exc:
                logger.error("worker crashed %s", safe_error(exc))
                copier.progress.set_fatal(safe_error(exc))
            if copier.progress.fatal:
                pool.shutdown(wait=False, cancel_futures=True)
                return False
    return not copier.progress.fatal


def heartbeat_loop(progress: CopyProgress, stop: threading.Event) -> None:
    while not stop.wait(HEARTBEAT_SECONDS):
        progress.heartbeat()


def write_summary(progress: CopyProgress, verification: dict[str, object], exit_code: int) -> None:
    payload = progress.snapshot()
    payload["verification"] = verification
    payload["exit_code"] = exit_code
    payload["log_path"] = str(LOG_PATH)
    SUMMARY_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    for handler in logger.handlers:
        handler.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="discover and compare with the bucket, then stop without writing",
    )
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    configure_logging()
    emit(f"log={LOG_PATH}")
    emit(f"status={STATUS_PATH}")
    if not CREDENTIALS_PATH.is_file():
        emit("Service account key file is missing.")
        return 1

    # Prove the plus sign survives object-name decoding before any upload.
    plus_name = object_name_from_url(
        source_url_for_path("inputs/features/biomass/biomasa_areara+subterranea_1km.tif")
    )
    if "+" not in plus_name or " " in plus_name:
        emit(f"object name decoding failed for biomass key: {plus_name}")
        return 1

    progress = CopyProgress(total=0)
    progress.set_phase("discover")
    session = make_session()
    try:
        by_name, dropped = build_work_items(session)
    except (PermanentCopyError, TransientError) as exc:
        emit(f"discovery failed {safe_error(exc)}")
        return 1
    progress.dropped = dropped
    progress.total = len(by_name)
    KEYS_PATH.write_text("\n".join(sorted(by_name)) + "\n", encoding="utf-8")
    emit(f"planned={len(by_name)} dropped={len(dropped)} dropped_keys={dropped}")
    progress.set_phase("list-destination")
    try:
        dest_sizes, dest_dispositions = load_destination_state()
    except Exception as exc:
        emit(f"destination list failed {safe_error(exc)}")
        return 1
    emit(f"destination_existing={len(dest_sizes)}")
    if args.dry_run:
        absent = sorted(name for name in by_name if name not in dest_sizes)
        emit(f"dry_run absent_from_bucket={len(absent)} sample={absent[:5]}")
        return 0

    progress.set_phase("copy")
    stop = threading.Event()
    heartbeat = threading.Thread(
        target=heartbeat_loop,
        args=(progress, stop),
        name="copy-heartbeat",
        daemon=True,
    )
    heartbeat.start()
    verification: dict[str, object] = {}
    exit_code = 1
    try:
        copier = BucketCopy(progress, dest_sizes, dest_dispositions)
        finished = copy_all(copier, by_name)
        progress.set_phase("verify")
        verification = {
            "index": verify_index(),
            "geojson": verify_public_get(
                "inputs/reference/colombia_outline_visual/v0.1.0/"
                "colombia_outline_visual.geojson"
            ),
        }
        if progress.tif_sample is not None:
            name, url, _nbytes = progress.tif_sample
            verification["tif"] = verify_length_match(name, url)
        else:
            verification["tif"] = {"ok": False, "error": "no tif was copied"}
        if progress.json_sample is not None:
            name, url, _nbytes = progress.json_sample
            verification["metrics"] = verify_length_match(name, url)
        else:
            verification["metrics"] = {"ok": False, "error": "no metrics json was copied"}
        checks = [
            bool(verification["index"].get("ok")),
            bool(verification["geojson"].get("ok")),
            bool(verification["tif"].get("match", verification["tif"].get("ok"))),
            bool(verification["metrics"].get("match", verification["metrics"].get("ok"))),
        ]
        emit(
            "verify "
            f"index={verification['index']} geojson_status={verification['geojson'].get('status')} "
            f"tif={verification['tif']} metrics={verification['metrics']}"
        )
        snapshot = progress.snapshot()
        emit(
            "SUMMARY "
            f"copied={snapshot['copied']} skipped={snapshot['skipped']} "
            f"failed={snapshot['failed']} missing={snapshot['missing']} "
            f"bytes={snapshot['bytes']} skipped_bytes={snapshot['skipped_bytes']} "
            f"fatal={snapshot['fatal'] or '-'}"
        )
        for item in progress.failures[:15]:
            emit(f"FAILED key={item['key']} error={item['error']}")
        for item in progress.missing_keys:
            emit(f"SOURCE_404 key={item['key']} error={item['error']}")
        for name in dropped:
            emit(f"DROPPED key={name}")
        exit_code = 0 if finished and progress.failed == 0 and all(checks) else 1
        return exit_code
    finally:
        stop.set()
        progress.set_phase("done")
        write_summary(progress, verification, exit_code)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        emit("interrupted")
        sys.exit(130)
