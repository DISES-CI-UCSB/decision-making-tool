"""Canonical taxonomic class to metric bucket contract.

The species catalog and the Prioritizr summary CSVs both name taxonomic classes,
and both feed rollups that have to agree with each other. This module is the one
place that mapping is defined so the two consumers cannot drift apart.

Deliberately free of geospatial dependencies so lightweight consumers such as
``conservation_goals`` can import it without pulling in rasterio.
"""

from __future__ import annotations

import re

CLASS_BUCKETS: tuple[str, ...] = ("mammals", "birds", "amphibians", "reptiles", "plants")

BUCKET_LABELS: dict[str, str] = {
    "mammals": "Mammals",
    "birds": "Birds",
    "amphibians": "Amphibians",
    "reptiles": "Reptiles",
    "plants": "Plants",
}

_CLASS_TO_BUCKET: dict[str, str] = {
    "mammalia": "mammals",
    "aves": "birds",
    "amphibia": "amphibians",
    "squamata": "reptiles",
    "crocodylia": "reptiles",
    "magnoliopsida": "plants",
    "magnoliospida": "plants",
}

#: Solvers split an oversized feature set into batches and suffix the class name
#: per batch, producing ``Magnoliopsida_1`` and ``Magnoliopsida_2``. The suffix
#: records batching, not taxonomy, so it is stripped before any lookup.
_BATCH_SUFFIX = re.compile(r"_\d+$")


def normalize_class_name(value: object) -> str:
    """Return the taxonomic class a value names, without any batching suffix."""

    return _BATCH_SUFFIX.sub("", str(value or "").strip())


def class_bucket(value: object) -> str | None:
    """Map a taxonomic class name onto a metric bucket, or ``None`` if unknown."""

    return _CLASS_TO_BUCKET.get(normalize_class_name(value).lower())
