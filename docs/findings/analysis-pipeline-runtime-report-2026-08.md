# Analysis pipeline runtime report — release 2.2.0

**Run:** `solutions-v2-2-0`  
**Catalog version:** `2.2.0`  
**Solutions:** 172 total — 168 land and 4 marine  
**Run started:** August 13, 2026 at 12:53 PM EDT  
**Local release ready:** August 14, 2026 at 10:24 PM EDT  
**Production frontend verified:** August 16, 2026 at 2:08 PM EDT  

## Executive summary

The full local analysis and release-build process took **33 hours 31 minutes of wall-clock time**. Of that period, approximately **29 hours 15 minutes 43 seconds** were active pipeline work and at least **4 hours 14 minutes** were avoidable idle time after a coordinator disconnected.

The best planning estimate for another run using the current architecture, three workers, a warm alignment cache, prompt phase handoffs, and no duplicate processes is **approximately 30 hours to a locally validated release**. Including upload, promotion, frontend deployment, and a scheduled review window, reserve **37–40 hours end to end** and begin at least **48 hours before the desired production release window**.

The observed 6–10 hour expectation was too low for the complete workflow. The regular metrics phase alone took about nine hours; MEC required another six hours; and species-goals sidecars required nearly thirteen additional hours.

## Absolute durations

| Milestone | Measured elapsed time |
| --- | ---: |
| Pipeline start → locally validated release | **33h 31m** |
| Active local processing | **29h 15m 43s** |
| Avoidable local idle time | **at least 4h 14m** |
| Upload and remote verification — 76.94 GB | **approximately 4h 45m** |
| Pipeline start → uploaded and remotely verified artifacts | **38h 26m** |
| Pipeline start → healthy production catalog/data | **59h 32m** |
| Pipeline start → deterministically verified production frontend | **73h 15m** |
| Pipeline start → manual production click confirmation | **73h 39m** |

The 73-hour calendar span includes overnight and daytime waits for review, authorization, incident discovery, and deployment. It should not be interpreted as 73 hours of computation.

## Was this a complete rerun?

**Yes, for the calculated metric artifacts.** All 172 regular verbose and compact metric documents were regenerated. All 1,008 MEC documents and all species-goals partitions were also regenerated.

The run did reuse lower-level inputs and caches:

| Reused from prior work | Effect |
| --- | --- |
| Downloaded source rasters | Avoided downloading unchanged source data again. |
| Aligned raster cache | Avoided repeating most raster reprojection and alignment work. |
| Species overlap/alignment cache for 8,298 available species | Avoided the approximately 1h49m cold alignment preflight observed earlier. |
| Unchanged solution rasters | Used the existing solution inputs; the optimization did not require rerunning Prioritizr or creating new solutions. |

The run did **not** reuse previous release metric artifacts:

| Regenerated component | Why prior artifacts were not reusable |
| --- | --- |
| Regular verbose — 172 files | Each file contains all geographies and binds to global boundary and catalog provenance. Changing the SIRAP boundary invalidated the whole document. |
| Regular compact — 172 files | Each compact file is derived from its complete verbose document and inherits its release/provenance binding. |
| MEC — 1,008 files | MEC now supports geography-level provenance, but the previous release used the older global-signature format. This migration regenerated the baseline once. |
| Species goals — 168 solutions × six partitions | The sidecars are stored per geography, but their current provenance includes a global boundary hash and species catalog/exception bindings. |
| Conservation goals — 172 files | These were inexpensive to regenerate and current release planning still applies one action to the whole solution. |
| Overlays, strategic outcomes, inventories, and manifests | These bind to the new catalog, report checksums, and exact artifact inventory. |

The pipeline therefore saved cold data-preparation time, but it did **not** avoid the dominant per-solution metric calculations.

## Can future runs reuse metrics?

**Partially today; substantially more with targeted pipeline work.**

### Reuse already supported

1. **Raster downloads and alignments are content-addressed.** Unchanged source rasters and target grids can continue using the existing cache.
2. **MEC now has geography-scoped signatures.** After this one-time baseline migration, a future change limited to SIRAP should require rebuilding only the SIRAP MEC partition—168 artifacts instead of all 1,008.
3. **Whole-solution reuse exists.** If a solution raster, all metric inputs, catalog binding, and provenance are unchanged—and checksum-pinned baseline signature and artifact inventories are available—the release planner can reuse that solution.
4. **Cheap derived components can be regenerated.** Goals, overlays, outcomes, inventories, and manifests do not require the expensive raster/species calculations.

### Reuse not yet supported

1. **Regular metrics are monolithic.** One file contains national, department, municipality, SIRAP, RUNAP, and OMEC values. A change to one geography invalidates the entire file.
2. **Species-goals provenance is global.** Although output is partitioned by geography, a boundary change currently invalidates all six partitions.
3. **The release planner is solution-level.** It chooses reuse or recompute once per solution, not separately by component and geography.
4. **Assembly support is incomplete.** The assembler does not yet safely combine reused and regenerated species-goals, overlays, and strategic outcomes into one release.
5. **Baseline evidence must be preserved.** Future reuse depends on retaining or publishing input-signature inventories and artifact inventories for the previous release.

### Expected benefit of improving reuse

A fail-closed component- and geography-level planner was previously estimated at **1.5–3 engineering days** of implementation and testing. Once available:

- Unchanged department, municipality, national, RUNAP, and OMEC metric subtrees could be validated and reused.
- Only changed SIRAP regular/species partitions would need expensive recalculation.
- A boundary-only update could plausibly fall from roughly **30 hours to 2–4 hours of compute**, although this estimate must be benchmarked after implementation.

The next release should preserve the 2.2.0 input-signature and artifact inventories as the certified reuse baseline rather than deleting the only copies after upload.

## Local pipeline chronology

All timestamps below are EDT.

| Date and time | Phase | Duration and result |
| --- | --- | --- |
| Aug 13, 12:53 PM | Release preparation | Catalog, exception contract, preflight validation, input signatures, and release plan. Approximately **14m**. |
| Aug 13, 1:07 PM | Regular metric workers started | Three workers processed 58, 57, and 57 solutions. |
| Aug 13, approximately 10:05 PM | Regular workers finished | **172/172 solutions**, zero failures. Slowest-worker window was approximately **8h58m**. |
| Aug 13, approximately 10:05–10:20 PM | Merge, compact, and goals | Worker outputs merged; 172 compact files produced; 172 conservation-goal files produced. |
| Aug 13, 10:20 PM | MEC generation started | Six geography artifacts for each of 168 land solutions. |
| Aug 14, approximately 4:32 AM | MEC generation finished | **1,008 artifacts**, zero failures, after **6h12m**. |
| Aug 14, approximately 4:33 AM | Species-goals build started | Three workers; 168 land solutions × six geography partitions. |
| Aug 14, 5:19 PM | Species-goals build finished | Exact duration **12h45m43s**; 8,298 available species processed; zero final failures. |
| Aug 14, 5:19–9:33 PM | No pipeline process active | Coordinator disconnected. Avoidable idle delay: **4h14m**. |
| Aug 14, 9:33 PM | Finalization started | Regular/species validation, assembly, inventories, upload dry-runs, candidate manifest, and display COG checks. |
| Aug 14, 10:24 PM | Local release ready | Finalization took approximately **51m**. |

### Active processing reconstruction

| Phase | Active time |
| --- | ---: |
| Preparation | 14m |
| Regular workers, merge, compact, and goals | 9h13m |
| MEC | 6h12m |
| Species goals | 12h45m43s |
| Final validation and assembly | 51m |
| **Total active processing** | **29h15m43s** |

## Post-compute delivery chronology

| Date and time | Event | Duration or outcome |
| --- | --- | --- |
| Aug 14, 10:34 PM–Aug 15, 3:19 AM | Upload and remote verification | **4h45m** for 4,060 artifacts totaling 76,942,495,924 bytes. There were 112 transient retries and zero final failures. |
| Aug 15, 3:19 AM–7:24 PM | Waiting for local-review request | **16h05m** human/calendar delay. |
| Aug 15, 7:24–7:33 PM | Full candidate loaded locally | Candidate manifest and SIRAP semantics refreshed. |
| Aug 15, 7:33–9:56 PM | Manual review | **2h23m** until production promotion approval. |
| Aug 15, 9:56 PM–Aug 16, approximately 12:10 AM | Promotion validation and metadata repair | Approximately **2h14m**. Missing report-level catalog signatures were repaired without changing artifact bytes. |
| Aug 16, approximately 12:10–12:25 AM | Production SIRAP incident remediation | **15m**. A missing immutable boundary path was backfilled with exact checksum-matched bytes. |
| Aug 16, 12:25 AM | Production catalog/data healthy | Production remained on release 2.2.0. |
| Aug 16, 1:18–2:06 PM | Frontend deployment | Approximately **48m**. Oversized local packaging attempts failed; a slim 59.3 MB deployment succeeded. |
| Aug 16, 2:08 PM | Deterministic frontend verification | Tests, build, manifest, boundary, and representative metric URLs passed. |
| Aug 16, 2:32 PM | Manual production confirmation | Authoritative Territorial SIRAP clickability confirmed. |

## Delays and inefficiencies observed

### 1. Species goals were generated as a separate heavy phase

The regular pipeline already processed species overlaps, but the chunked worker commands did not emit mergeable species-goals sidecars. A separate three-worker build then spent **12h45m43s** producing the deployable catalog, six partitions per solution, completion metadata, and inventory.

This was the largest single phase and is the clearest optimization opportunity.

### 2. Duplicate species-goals processes

Disconnected coordinators launched multiple duplicate species builds. At least four duplicate process trees were detected and terminated while the canonical build continued. The duplicates caused CPU and disk contention, but the exact penalty cannot be isolated from available evidence.

A release-level lock should prevent more than one build for the same release and component.

### 3. Coordinator disconnect created a four-hour idle gap

After species generation completed, no process advanced the release for **4h14m**. Automatic, persisted phase handoffs would have reduced the local wall-clock result from 33h31m to about 29h17m.

### 4. Validation reread very large artifact sets

Several safety checks reread or rehashed tens of gigabytes. The checks were valuable, but their results were not always persisted in a reusable form. Promotion initially failed because report metadata omitted catalog signatures even though artifact bytes already contained valid signatures.

Validation evidence should be content-addressed and reused when artifact bytes have not changed.

### 5. Review and authorization were not scheduled

At least **18h28m** of the release calendar was spent waiting for explicit review or promotion authorization:

- 16h05m after upload before local review began
- 2h23m between candidate readiness and promotion approval

Additional time elapsed before the stale frontend deployment was identified and authorized.

### 6. Local frontend deployment packaged generated data

Vercel CLI initially attempted to package 16.4 GB of local repository data. A slim 59.3 MB deployment package ultimately succeeded. Future deployment tooling must exclude generated metric releases and local preview assets by construction.

## Next-run estimate

### Current architecture

Use these planning figures if the pipeline is run again without architectural changes:

| Stage | Recommended reservation |
| --- | ---: |
| Local compute and validation | **30h** |
| Upload and remote verification | **5–6h** |
| Promotion and live verification | **0.5–1h**, plus a 2h contingency |
| Frontend deployment | **15–30m** |
| Scheduled manual review | **1–1.5h** |
| **Practical end-to-end window** | **37–40h** |

Begin the run at least **48 hours before the desired release time** to absorb transient failures without forcing unsafe shortcuts.

If coordinator disconnects or manual handoffs recur, expect local readiness to return to approximately **33–34 hours**.

## Recommendations before the next full run

1. **Generate mergeable species-goals outputs during the regular worker phase.** Avoid a second species-heavy pass.
2. **Add a release-level process lock.** Refuse duplicate component builds for the same release ID.
3. **Persist phase state and automatically advance successful handoffs.** A disconnected agent should not leave the pipeline idle.
4. **Write per-worker progress reports.** Record start, finish, current solution, completed count, failure count, and estimated remaining work.
5. **Adopt component- and geography-level reuse.** Unchanged departments, municipalities, national, RUNAP, and OMEC calculations should not be recomputed when only SIRAP changes.
6. **Persist reusable validation evidence.** Reuse checksums and contract results while source artifact bytes remain unchanged.
7. **Create a slim, committed frontend deployment workflow.** Generated data and preview files must never enter the Vercel source archive.
8. **Schedule reviewer availability before compute begins.** Reserve a fixed review and promotion window immediately after upload.

## Estimate confidence and limitations

The major phase durations are measured from terminal start/end metadata and release reports. Worker 1 and worker 2 did not preserve standalone exact duration summaries, so the regular phase uses the observed shared window and worker-0 timing. Duplicate species-process contention cannot be quantified precisely.

The generated local release directory was removed after successful publication, so this report relies on contemporaneous terminal records and release summaries preserved in the [2.2.0 release conversation](d5624af5-4345-47a4-89ba-2aabbf16de69).

## Separate backend deployment appendix

Backend deployment was not part of the analysis-pipeline runtime:

- First deployment selected the wrong legacy runtime artifact, caused approximately 63 seconds of interruption, and rolled back in approximately 15 seconds.
- The retry pinned the correct release artifact and succeeded with approximately 13 seconds of startup interruption.
- The runtime artifact itself was unchanged.
