from __future__ import annotations

from urllib.parse import unquote, urlparse

from .errors import BrokerError

_MAX_OBJECT_NAME_LENGTH = 1024
# Public blob host: aagibolq28slyfof.public.blob.vercel-storage.com
_PUBLIC_BLOB_HOST = "aagibolq28slyfof.public.blob.vercel-storage.com"
_GCS_HTTPS_HOSTS = frozenset({"storage.googleapis.com", "storage.cloud.google.com"})


def normalize_object_name(raw: str) -> str:
    """GCS object key. Reject traversal, URLs, and empty path segments."""
    name = raw.strip()
    if not name or len(name) > _MAX_OBJECT_NAME_LENGTH:
        raise _invalid_object_name()
    if any(char in name for char in ("\\", "\x00", "?", "#")):
        raise _invalid_object_name()
    if name.startswith("/") or "://" in name:
        raise _invalid_object_name()
    parts = name.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise _invalid_object_name()
    return name


def object_name_from_reference(value: str) -> str | None:
    """Turn a catalog pathname, gs:// URI, or known https host into an object key."""
    text = value.strip()
    if not text:
        return None
    if text.startswith("gs://"):
        remainder = text[5:]
        slash = remainder.find("/")
        if slash < 0 or slash == len(remainder) - 1:
            return None
        text = unquote(remainder[slash + 1 :])
    elif "://" in text:
        parsed = urlparse(text)
        if parsed.scheme != "https":
            return None
        host = (parsed.hostname or "").lower()
        path = unquote(parsed.path).lstrip("/")
        if host == _PUBLIC_BLOB_HOST:
            if not path:
                return None
            text = path
        elif host in _GCS_HTTPS_HOSTS:
            bucket, separator, key = path.partition("/")
            if not separator or not bucket or not key:
                return None
            text = key
        else:
            return None
    try:
        return normalize_object_name(text)
    except BrokerError:
        return None


def _invalid_object_name() -> BrokerError:
    return BrokerError(
        422,
        "invalid_object_name",
        "object_name must be a relative GCS object key.",
    )
