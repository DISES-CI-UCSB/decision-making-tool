# v0.2 Solution Release Operations Log

This append-oriented log records operational work for the v0.2 solution release:
what ran, why it ran, how long it took, its outcome, and lessons for later
release work. Entries should be preserved as durable release history rather
than rewritten as a task tracker.

All dates and times are US Eastern. Timelines distinguish single command runs
from periods containing multiple commands, investigation, or corrections.

## Cold frozen-v3 signature and inventory rebuild

- **What:** Rebuilt proof-of-input and provenance identities, not metrics.
- **Why:** The provenance/signature contract changed to v3, and the approved
  two-species exception needed to be bound into the frozen artifacts. Existing
  signatures could not certify the new frozen inputs.
- **How:** Inspected the exact solution rasters, 8,298 available species
  rasters, other metric layers, canonical grid and alignment policy, catalog,
  and approved exception. The process validated and cached aligned inputs,
  checksummed them, and combined the results into deterministic per-solution
  signatures and the release inventory.
- **Why it took about two hours:** The cost was cold geospatial I/O and
  validation across thousands of rasters, not SHA computation. Later warm
  full-land repeats took 3–5 minutes, while comparisons took under one minute.

## Timeline

### Wednesday, August 5, 2026

- **10:02:45–10:03:10 AM (25s):** Validated the frozen release's exact species
  inputs.
- **10:03:57–10:07:19 AM (3m22s):** Validated all species on the land grid.
- **10:09:11 AM–11:58:23 AM (1h49m12s):** Completed final frozen species
  validation.
- **11:59:05 AM–12:03:23 PM (4m18s):** Repeated frozen species validation with
  warm caches.
- **12:37:40–12:41:54 PM (4m14s):** Replayed validation only against warm
  caches.
- **12:48:09–2:44:48 PM (1h56m39s):** Regenerated the frozen v3 release
  signatures.
- **2:44:55–2:46:51 PM (1m56s):** Bound the approved species exception into
  the frozen v3 artifacts.
- **3:45:32–4:06:47 PM (21m16s):** Uploaded 344 immutable source artifacts.
- **4:07–4:38 PM:** Ran scientific smoke tests and made corrections through
  multiple commands and review steps; this was not one continuous command.
- **8:47:34–8:49:30 PM (1m56s):** Generated regular metrics for all four marine
  solutions with zero failures.
- **8:49:50 PM–Thursday 8:28:25 AM (11h38m35s):** Ran the initial two-worker
  terrestrial regular-metrics pass. It retained 96 canonical caches and
  rejected 72 under the then-incomplete species-target validation.

### Thursday, August 6, 2026

- **8:39–9:56 AM:** Performed dual-reference and per-species smoke
  certification through multiple commands.
- **9:09:06–9:13:26 AM (4m20s):** Generated a representative scalar input
  signature.
- **9:13:51–9:16:52 AM (3m01s):** Generated current signatures only for all
  land solutions.
- **9:58:32–10:03:55 AM (5m24s):** Generated full-land signatures as cache
  proof.
- **10:04:09–10:04:55 AM (46s):** Verified scalar worker signatures.
- **10:22:39–10:23:15 AM (36s):** Compared existing worker signatures.
- **10:40:38 AM–3:43:36 PM (5h03m):** Resumed the remaining 72 terrestrial
  regular metrics using cache, with zero failures.
- **3:43–3:48 PM (~5m):** Merged 172 regular metric documents and corrected
  domain validation.
- **4:02–4:03 PM (~1m):** Generated 172 conservation-goal sidecars. They were
  later regenerated after the binding fix in another run of about one minute.
- **4:19:47–4:30:32 PM (10m45s):** Compacted 15,076,636,845 bytes to
  3,901,777,940 bytes, a 0.2588 ratio.
- **4:31:11–5:39:21 PM (1h08m10s):** Started MEC v2 generation for 168 land
  solutions across six geographies, totaling 1,008 detailed artifacts. An
  internet outage stopped the run after 31 solutions and 186 artifacts. The
  completed artifacts remained cached.
- **10:58:40 PM–Friday 3:58:13 AM (4h59m33s):** Confirmed Blob connectivity
  and resumed MEC v2 from solution 32 without recalculating the 186 cached
  artifacts. The resumed run completed all 1,008 MEC artifacts with zero
  failures.

## Artifact taxonomy

- **Signatures and provenance identities:** Deterministic evidence describing
  exactly which source inputs, policies, catalog state, and approved exceptions
  a solution release used. They certify inputs; they are not metric results.
- **Regular verbose metric documents:** Full standard metric outputs for each
  solution, retaining detailed values and supporting metadata.
- **Compact metrics:** Size-reduced representations of regular metrics intended
  for efficient delivery and consumption.
- **Conservation-goal sidecars:** Separate artifacts that bind
  conservation-goal information to the corresponding solution outputs.
- **MEC v2 detailed ecosystem sidecars:** Geography-specific detailed ecosystem
  artifacts generated for each land solution under the MEC v2 contract.

## Operational lessons

- Cold validation time is dominated by opening, aligning, and validating
  thousands of geospatial rasters. Warm caches make signature regeneration and
  comparison dramatically faster.
- Validation rules must be complete before distributed metric runs begin;
  incomplete species-target validation caused 72 otherwise resumable land
  outputs to be rejected.
- Approved exceptions must be bound into provenance artifacts before dependent
  sidecars are finalized, or those sidecars require regeneration.
- Status language must remain precise: say **all regular metric documents
  complete** until MEC generation and release packaging are also finished.
