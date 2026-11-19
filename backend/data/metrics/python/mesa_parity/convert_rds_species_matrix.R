#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(jsonlite)
  library(Matrix)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 5) {
  stop(
    "Usage: convert_rds_species_matrix.R INPUT.rds OUTPUT.smtx.gz WIDTH HEIGHT CLASS",
    call. = FALSE
  )
}

input_path <- args[[1]]
output_path <- args[[2]]
width <- as.integer(args[[3]])
height <- as.integer(args[[4]])
taxonomic_class <- args[[5]]

matrix <- readRDS(input_path)
if (!inherits(matrix, "dgCMatrix")) {
  stop("Input must be a Matrix::dgCMatrix.", call. = FALSE)
}
if (nrow(matrix) != width * height) {
  stop(
    sprintf(
      "Matrix rows (%s) do not match WIDTH * HEIGHT (%s).",
      nrow(matrix),
      width * height
    ),
    call. = FALSE
  )
}
if (is.null(colnames(matrix)) || any(!nzchar(colnames(matrix)))) {
  stop("Every matrix column must have a species name.", call. = FALSE)
}

counts <- diff(matrix@p)
offsets <- cumsum(c(0, head(counts, -1))) * 4
species <- lapply(seq_len(ncol(matrix)), function(column_index) {
  list(
    name = colnames(matrix)[[column_index]],
    class = taxonomic_class,
    offset = unname(offsets[[column_index]]),
    count = unname(counts[[column_index]])
  )
})
toc <- charToRaw(toJSON(
  list(
    grid = list(width = width, height = height),
    species = species
  ),
  auto_unbox = TRUE,
  null = "null"
))

dir.create(dirname(output_path), recursive = TRUE, showWarnings = FALSE)
connection <- gzfile(output_path, open = "wb", compression = 9)
writeBin(charToRaw("SMSP"), connection)
writeBin(length(toc), connection, size = 4, endian = "little")
writeBin(toc, connection)

for (column_index in seq_len(ncol(matrix))) {
  start <- matrix@p[[column_index]] + 1
  end <- matrix@p[[column_index + 1]]
  if (start > end) {
    next
  }
  cell_ids <- matrix@i[start:end]
  deltas <- c(cell_ids[[1]], diff(cell_ids))
  writeBin(as.integer(deltas), connection, size = 4, endian = "little")
}
close(connection)

message(
  sprintf(
    "Converted %s species and %s occupied cells.",
    ncol(matrix),
    sum(counts)
  )
)
