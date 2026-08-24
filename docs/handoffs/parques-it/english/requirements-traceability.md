[← Back to handoff overview](./README.md)

# Source Requirements and Traceability

This document is the authoritative intake checklist for the handoff: every requirement extracted from the two source PDFs, mapped to current repository coverage and a status. For the consolidated list of decisions Parques IT actually needs to make, see the [Top decisions table](./README.md#top-decisions-parques-it-must-make) in the overview — this document is the detailed, ask-by-ask backing for that list.

> **Interpretation note:** The September 2025 GTIC analysis discusses an earlier R/Shiny-oriented system, including six CPU cores, 16 GB of memory, three-user observations, Gurobi/CBC, and R/Shiny maintenance. **Those values must not be presented as requirements or measurements for the current Angular/FastAPI implementation.** The architecture has changed; legacy assumptions must be replaced with current, measured evidence.

## Source documents

- **GTIC-PNNC analysis**, "Análisis documento: Priorizando la Naturaleza-Colombia — Requisitos técnicos," pages 1–3 (September 2025). Requests stronger evidence and operational documentation before software reception.
- **"DISES MNP" presentation**, July 9, 2026, slides 1–8. Lists project deliverables and unresolved national-model, SIRAP, data, and branding questions.

<a id="gtic-software-reception-requirements"></a>
## GTIC software-reception requirements

🔴 **REQ-09 and REQ-14 are flagged separately below** — they are the only two GTIC items with _zero_ evidence of any kind (not even a partial artifact), and both were requested by name.

| ID         | Category                         | Requirement                                                                                                | Status                          | Next evidence or decision                                                                                                                                                                        |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-01     | Release & Versioning             | Identify the final software version, expected completion date, and anticipated near-term changes.          | 🔴 Gap — no evidence found      | Record release commit, version tag, deployment URL, freeze date, known exclusions, change-control process.                                                                                       |
| REQ-02     | Testing & Security               | Describe the complete scope of testing and production performance metrics.                                 | ⚪ Planned, not yet executed    | Approve objectives, execute the phased test plan in [`performance-testing.md`](./performance-testing.md), retain evidence.                                                                       |
| REQ-03     | Capacity & Scalability           | Provide hardware resource requirements; clarify whether sizing applies to a container or its host server.  | ⚪ Planned, not yet executed    | Measure frontend, backend container, host, storage, and client requirements under representative workloads.                                                                                      |
| REQ-04     | Capacity & Scalability           | Provide verified scalability limits and a growth/peak plan, including whether load balancing is required.  | ⚪ Planned, not yet executed    | Run expected-load and saturation tests; identify bottlenecks; document scaling triggers and architecture.                                                                                        |
| REQ-05     | Interoperability & Institutional | Document interoperability with PNNC systems, external services, identity, and user-management mechanisms.  | 🟡 Team confirmation required   | Inventory PNNC identity, network, data, monitoring, and records systems; test approved integration paths.                                                                                        |
| REQ-06     | Interoperability & Institutional | Explain institutional customization and compliance with government application standards.                  | 🔴 Gap — no evidence found      | Obtain applicable design, accessibility, security, branding, hosting, and records standards; produce a compliance matrix.                                                                        |
| REQ-07     | Capacity & Scalability           | Provide a scalability and long-term support plan.                                                          | 🔴 Gap — no evidence found      | Assign maintenance, patching, monitoring, backup, incident, data-publication, and escalation ownership.                                                                                          |
| REQ-08     | Testing & Security               | Provide integration testing and a more comprehensive load-test plan.                                       | ⚪ Planned, not yet executed    | Add staging end-to-end integration tests; execute performance tests against the approved topology.                                                                                               |
| **REQ-09** | **Testing & Security**           | **Provide an executed and supported security-test plan, including mitigation or accepted-risk treatment.** | 🔴 **Gap — no evidence found**  | Approve threat model and test scope, perform security testing, document mitigation/owner/due date/residual risk/acceptance.                                                                      |
| REQ-10     | Documentation & Manuals          | Document functional use cases.                                                                             | 🟡 Team confirmation required   | Convert workflows into role-based use cases with preconditions, normal flow, exceptions, outputs, acceptance criteria.                                                                           |
| REQ-11     | Documentation & Manuals          | Provide screen design or a nonfunctional prototype.                                                        | 🟡 Team confirmation required   | Confirm whether annotated production screenshots satisfy the request, or whether PNNC needs a separate design package.                                                                           |
| REQ-12     | Testing & Security               | Provide a formal functional and nonfunctional test plan.                                                   | ⚪ Planned, not yet executed    | Approve scope, owners, environments, entry/exit criteria, evidence retention, sign-off authority.                                                                                                |
| REQ-13     | Training & Support               | Provide a functional training plan.                                                                        | 🔴 Gap — no evidence found      | Define audiences, curriculum, exercises, delivery dates, attendance evidence, evaluation, post-training support.                                                                                 |
| **REQ-14** | **Training & Support**           | **Provide ANS (service-level) supporting documents.**                                                      | 🔴 **Gap — no evidence found**  | Agree availability, support hours, severity levels, response/resolution targets, exclusions, maintenance windows, RTO, RPO, reporting.                                                           |
| REQ-15     | Documentation & Manuals          | Create a technical manual declaring language and development-package versions.                             | 🟡 Team confirmation required   | Complete reproducible build, deployment, configuration, operation, backup, restoration, troubleshooting, upgrade instructions — consolidated into **one** manual, not scattered across sections. |
| REQ-16     | Documentation & Manuals          | Create functional user manuals.                                                                            | 🔴 Gap — no evidence found      | Produce role-based Spanish guidance; determine whether an English counterpart is required alongside the videos.                                                                                  |
| REQ-17     | Legacy & Source Transfer         | Monitor R and Shiny updates to prevent vulnerabilities.                                                    | 🟠 Parques IT decision required | Formally exclude the archived R/Shiny runtime if it will not be deployed; otherwise establish separate dependency/vulnerability management.                                                      |
| REQ-18     | Legacy & Source Transfer         | Transfer source programs with a development guide.                                                         | 🟡 Team confirmation required   | Document repository ownership, licenses, branches, build workflow, code standards, CI, release process, maintainer onboarding.                                                                   |

## July 2026 stated deliverables

| ID     | Deliverable                                                               | Status                        | Next action                                                                                                                  |
| ------ | ------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| DEL-01 | Technical documentation with architecture diagrams.                       | 🟡 Team confirmation required | Validate against the deployed environment; obtain technical review. (This handoff package is that documentation.)            |
| DEL-02 | Memory, software, and language requirements.                              | ⚪ Planned, not yet executed | Benchmark browser and backend resources using production-sized data.                                                         |
| DEL-03 | Usability testing.                                                        | ⚪ Planned, not yet executed | Integrate the remaining layers and last-minute features, freeze a stable release candidate, then execute the plan in [`usability-testing.md`](./usability-testing.md) and retain results. |
| DEL-04 | Open repository containing model-run and web-tool source code.            | 🟡 Team confirmation required | Verify model-run sources, dependencies, licenses, data exclusions, recipient access. No repository license currently exists. |
| DEL-05 | User-guide videos in English and Spanish.                                 | 🔴 Gap — no evidence found    | Approve scripts and release UI, record both languages, caption them, verify accessibility.                                   |
| DEL-06 | Final workshop with SIRAP users and meetings with Mesa Nacional and GTIC. | 🔴 Gap — no evidence found    | Assign organizers, agenda, participants, exercises, feedback capture, decisions, attendance evidence.                        |

<a id="scientific-and-model-questions"></a>
## Scientific and model questions

These affect the credibility of the application and UAT expected results, but cannot be resolved by infrastructure documentation alone — they need a scientific owner.

- **Freshwater data:** Confirm use of IDEAM's 2018 Estudio Nacional del Agua, the groundwater-recharge variables, and the rule that moderate/high values become 1 while low/very-low values become 0.
- **Carbon data:** Explain how `agb_plus_bgb_spawn_2020_fixed_1km.tif` was generated, why values appear lower than the Spawn reference dataset, and whether units are MgC/ha, MgC/km², or another measure.
- **Scenario count:** Confirm removal of the 17% and 30% thresholds for nationally responsible species, and whether the expected number of model runs changes from 216 to 168.
- **Included territories:** Confirm whether Afro-Colombian community territories and Indigenous reserves remain included as management figures.
- **Scenario logic:** Confirm whether ecosystems are always included, and whether species are evaluated only when strategic ecosystems are evaluated.
- **SIRAP models:** Confirm run counts, data sources, metadata, thresholds, objectives, and repeatable execution methods.
- **Branding:** Confirm all logo and attribution requirements, including whether "Where to Work" logos remain necessary.

## Do not publish these unsupported claims

The following statements are either contradicted by the current repository or lack sufficient evidence. They must stay excluded from any handoff material until validated.

- Do not describe the application as purely static or claim no server computation is required — Firebase, Firestore, protected publishing, and the deployed FastAPI custom-area service are runtime dependencies.
- Do not describe the metrics API as merely optional, or claim every custom-area metric runs in the browser — production routing sends custom-area requests to FastAPI. (`docs/gtic-system-architecture-slides.md` previously had stale wording calling this service optional/future; it has been corrected as part of this review.)
- Do not use six CPU cores, 16 GB of memory, three users, or legacy Gurobi/CBC tests as current web-platform sizing or capacity evidence.
- Do not claim reproducible source code exists for every national model execution — the repository contains web/API/pipeline code, outputs, metadata, and legacy R code, but the current national solver package requires confirmation.
- Do not call the repository "open source" until an approved repository-level license and supported components are identified.
- Do not claim all runtime dependencies are fully locked — npm has a lockfile, but Python requirements still use minimum-version ranges. The container and CI now agree on Python 3.12, but exact dependency locking remains future work.
- Do not claim formal end-to-end tests exist — current automated evidence is unit, contract, manifest, fixture, and narrow browser smoke tests. All 24 backend tests pass after correcting a drifted synthetic raster fixture, but arbitrary custom-AOI category-mask behavior still needs a targeted production-path regression test; see [`performance-testing.md`](./performance-testing.md#backend-fixture-correction-and-remaining-production-concern).
- Do not label carbon values as MgC/ha, or report carbon totals as validated, until source derivation, units, transformation, and independent checks are approved.
- Do not claim 168 final scenarios — current repository evidence does not substantiate that complete catalog.
- Do not claim Indigenous reserves are included in active scenarios merely because source data exists — current wiring and scenario intent require confirmation.
- Do not claim SIRAP model packages have been delivered — the current SIRAP solution area is documented as future or empty.
- Do not claim public Blob assets are currently protected by a complete proxy — a proxy configuration hook exists, but no complete implementation was found.

## Additional evidence findings

- The application and design materials exceed GTIC's earlier request for a nonfunctional prototype. The final package should provide the deployed URL, supported-browser list, annotated production screenshots, and screen inventory instead of building a separate obsolete prototype.
- The repository provides strong raw material for a technical manual (REQ-15), but it still needs consolidation into one versioned, reproducible operations package — right now the facts are accurate but scattered across [`architecture.md`](./architecture.md), [`cybersecurity.md`](./cybersecurity.md), and [`performance-testing.md`](./performance-testing.md).
- Firebase and Firestore implement meaningful user-management controls, but PNNC still must approve the identity provider, provisioning/deprovisioning process, project ownership, audit retention, and periodic access review.
- Institutional customization must be validated against the actual PNNC or Gobierno Digital design, accessibility, security, records, and branding standards — not inferred from bilingual support alone.
