# data/metrics/js/

Browser parity and performance benchmark track for metric calculation.

**This is not production Angular code.** Code here exists to answer one
question: _can these metrics run in the browser fast enough to support custom
AOI calculation, or do we need a Python API?_

## Purpose

- Implement the same metric calculations as the Python pipeline.
- Use the shared fixtures in `data/metrics/fixtures/` to prove parity with
  Python results.
- Benchmark aggregate browser runtime (download → decompress → parse →
  calculate) using realistic input sizes.
- Measure Web Worker feasibility: can the AOI bundle run without freezing the
  UI?

If benchmark results are acceptable, individual calculators can be promoted
into the Angular frontend. If not, a Python API is the fallback for custom AOI
metrics.

## Folder structure

```
js/
  README.md          ← you are here
  src/               ← metric calculator modules (mirrors python/metrics_pipeline/calculators/)
  tests/             ← unit tests (consume shared fixtures from data/metrics/fixtures/)
  benchmarks/        ← browser/Node timing harnesses
```

## Status

Not yet started. This track begins after the Python pipeline (T2–T5) is
trusted. See T8 in the [Notion implementation plan](https://www.notion.so/3671237a5ea380d6a26fd09d78a92364).
