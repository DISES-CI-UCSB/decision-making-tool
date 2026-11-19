"""Sparse artifact pipeline (T8b/T8c).

Encoders, decoders, and CLIs for the gzipped delta-encoded sparse sidecar
format (.sparse.gz) and the combined per-taxon species matrix format
(.smtx.gz).  See ``format.py`` for the on-disk binary spec.
"""

from .format import (
    SMTX_MAGIC,
    SMSP_MAGIC,
    LAYER_TYPE_BINARY,
    LAYER_TYPE_CATEGORICAL,
    LAYER_TYPE_CONTINUOUS,
    SparseArtifact,
    SparseMetadata,
    SpeciesMatrixEntry,
    decode_sparse_bytes,
    decode_species_matrix_bytes,
    encode_sparse_artifact,
    encode_species_matrix,
    iter_species_matrix_chunks,
)

__all__ = [
    "SMTX_MAGIC",
    "SMSP_MAGIC",
    "LAYER_TYPE_BINARY",
    "LAYER_TYPE_CATEGORICAL",
    "LAYER_TYPE_CONTINUOUS",
    "SparseArtifact",
    "SparseMetadata",
    "SpeciesMatrixEntry",
    "decode_sparse_bytes",
    "decode_species_matrix_bytes",
    "encode_sparse_artifact",
    "encode_species_matrix",
    "iter_species_matrix_chunks",
]
