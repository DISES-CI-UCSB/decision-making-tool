# Parques IT Technical Handoff — Decision Making Tool

## What this is and who it's for

This is the technical handoff package for the Decision Making Tool, prepared for the IT team (GTIC) at Parques Nacionales Naturales de Colombia (PNNC). It documents what the system currently is, what evidence backs each claim, and what is still a gap or an open decision for Parques to make.

**Every claim in this handoff is labeled with one of five statuses** (see legend below) so a reviewer can tell at a glance what to trust, what to verify, and what still needs to be produced. Client-side measurements from 7 Sep 2026 are on [Performance, Load, and Saturation Testing](./performance-testing.md).

## How to read this package

| Document                                                         | Covers                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **README.md** (this file)                                        | Purpose, glossary, status legend, top decisions Parques must make                                                   |
| [`architecture.md`](./architecture.md)                           | System purpose, components, deployment, runtime requirements, configuration                                         |
| [Branding and Attribution](https://docs.google.com/document/d/1mThmI_KmTT8kE2s02s_ymhdHL-BUxyIl8lxuwXJ76aM/edit?tab=t.s2xjesl1ye0i) (Google Doc tab) | Product name EcoPlan, shipped header/about logos, remaining Gobierno Digital / SIRAP slot / attribution decisions |
| [`data-operations/`](./data-operations/README.md)                | Index of operator runbooks for solutions, layers, AOIs, metrics, publishing, and rollback — not a procedure itself  |
| [SIRAP Regional Solutions](https://docs.google.com/document/d/1mThmI_KmTT8kE2s02s_ymhdHL-BUxyIl8lxuwXJ76aM/edit?tab=t.oqw67lnj8o9t) (Google Doc tab) | Parallel regional product line (dual catalog, packet v2, certified Finder); do not use national Adding Solutions |
| [`cybersecurity.md`](./cybersecurity.md)                         | Trust boundaries, current controls, findings, risk register                                                         |
| [`usability-testing.md`](./usability-testing.md)                 | Usability and user-acceptance testing plan, deferred until the release candidate is stable                         |
| [`performance-testing.md`](./performance-testing.md)             | Load, stress, saturation, and soak testing plan and current evidence                                                |
| [`requirements-traceability.md`](./requirements-traceability.md) | Every GTIC and July 2026 requirement mapped to evidence and status                                                  |

## How to navigate this package

A reviewer with ten minutes should read this README and the **Top decisions** table, then open only the topic that matches their role.

- **Data Operations** is an index of operator runbooks, not a procedure. Start at [`data-operations/README.md`](./data-operations/README.md) and open one runbook from there.
- **SIRAP regional solutions** live on a Google Doc tab, not in the national runbooks: [SIRAP Regional Solutions](https://docs.google.com/document/d/1mThmI_KmTT8kE2s02s_ymhdHL-BUxyIl8lxuwXJ76aM/edit?tab=t.oqw67lnj8o9t).

## Status legend

Every finding, requirement, and claim in this handoff package uses one of these five statuses:

| Status                              | Meaning                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| ✅ **Verified**                     | Confirmed directly from source code, configuration, or a test that was actually run and whose output is quoted.  |
| 🟡 **Team confirmation required**   | A likely interpretation that the project team must validate before it can be treated as fact.                    |
| 🟠 **Parques IT decision required** | A deployment, security, ownership, or policy choice that only the receiving organization can make.               |
| ⚪ **Planned, not yet executed**    | A test, artifact, or document that has a defined plan but does not exist yet.                                    |
| 🔴 **Gap — no evidence found**      | Requested by GTIC or the July 2026 deliverables list, with no plan or evidence found anywhere in the repository. |

## Glossary

| Term          | Meaning                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **GTIC**      | Grupo de Tecnologías de Información y Comunicaciones — the PNNC IT unit receiving this handoff.                                              |
| **PNNC**      | Parques Nacionales Naturales de Colombia — the receiving institution.                                                                        |
| **SIRAP**     | Sistema Regional de Áreas Protegidas. Three uses in this tool: (1) map boundary AOI; (2) regional solution catalog; (3) Firebase access region. Only Eje Cafetero and Orinoquía have catalog/access data. |
| **RUNAP**     | Registro Único Nacional de Áreas Protegidas — Colombia's national protected-areas registry.                                                  |
| **OMEC**      | Otras Medidas de Conservación (Other Effective Area-Based Conservation Measures) — a conservation-area category distinct from RUNAP.         |
| **AOI**       | Area of Interest — a geographic area a user selects or draws to see conservation metrics.                                                    |
| **UAT**       | User Acceptance Testing — scripted pass/fail testing against agreed requirements, distinct from usability testing.                           |
| **ANS**       | Acuerdo de Nivel de Servicio (Service Level Agreement) — the support/response-time contract GTIC has requested.                              |
| **RTO / RPO** | Recovery Time Objective / Recovery Point Objective — how fast and how completely the system must recover after an incident.                  |
| **COG**       | Cloud Optimized GeoTIFF — a raster format that supports fast partial reads over HTTP.                                                        |
| **WCAG**      | Web Content Accessibility Guidelines — the accessibility standard referenced in usability testing.                                           |
| **SUS / SEQ** | System Usability Scale / Single Ease Question — standard usability-testing metrics.                                                          |

<a id="top-decisions-parques-it-must-make"></a>
## Top decisions Parques IT must make

This table consolidates every open decision and acceptance blocker found across the whole handoff package into one list. Detail and rationale live in the linked document; this table exists so nothing has to be read three times to find "what do we actually need to decide."

| #   | Decision                                                                                                                                                                                                                                                              | Status                          | Detail                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Approve one final release identity: commit, version tag, deployment URL, freeze date, and change-control process.                                                                                                                                                     | 🔴 Gap — no evidence found      | [`requirements-traceability.md`](./requirements-traceability.md#gtic-software-reception-requirements) REQ-01                                                   |
| 2   | Decide whether public, unauthenticated read access is acceptable for all currently published geospatial data (including conflict, Indigenous-territory, and species layers), or whether some data must move behind authenticated/private storage.                     | 🟠 Parques IT decision required | [`cybersecurity.md`](./cybersecurity.md#findings-and-risk-register) SEC-01                                                                                     |
| 3   | Decide the metrics API's long-term home (GTIC infrastructure vs. the current external VM), and require authentication/rate-limiting before it is treated as production-ready.                                                                                         | 🟠 Parques IT decision required | [`cybersecurity.md`](./cybersecurity.md#findings-and-risk-register) SEC-02, [`architecture.md`](./architecture.md#architecture-decisions-requiring-validation) |
| 4   | Decide whether Firebase Google sign-in is acceptable or whether a Parques institutional identity provider is required.                                                                                                                                                | 🟠 Parques IT decision required | [`cybersecurity.md`](./cybersecurity.md#security-decisions-requested-from-parques-it)                                                                          |
| 5   | Align the Docker image and CI Python versions. The Dockerfile is `python:3.11-slim`; CI tests 3.11 and 3.12. Do not treat 3.12 as the verified container runtime.                                                                                                    | 🟡 Team confirmation required   | [`architecture.md`](./architecture.md#runtime-and-deployment-requirements)                                                                                     |
| 6   | Assign an owner to resolve remaining scientific/model sign-off (carbon units and derivation, IHEH2030 provenance, freshwater provenance, national scenario count and logic, included territories) before any UAT expected results are approved. SIRAP solution packages are delivered: 56 published scenarios (40 Eje Cafetero, 16 Orinoquía).                                    | 🟡 Team confirmation required   | [`requirements-traceability.md`](./requirements-traceability.md#scientific-and-model-questions)                                                                |
| 7   | Decide the actual transfer boundary: does the handoff include reproducible national-model execution code, or only model outputs? Approve a repository license before calling anything "open source."                                                                  | 🔴 Gap — no evidence found      | [`requirements-traceability.md`](./requirements-traceability.md#gtic-software-reception-requirements) REQ-18, DEL-04                                           |
| 8   | Execute the security test plan and document mitigation or accepted risk. **Zero evidence exists for this today** — it is one of the two GTIC asks with nothing to show yet.                                                                                           | 🔴 Gap — no evidence found      | [`requirements-traceability.md`](./requirements-traceability.md#gtic-software-reception-requirements) REQ-09                                                   |
| 9   | Agree service-level terms (ANS): support hours, severity levels, response/resolution targets, RTO/RPO. **Zero evidence exists for this today** — the second GTIC ask with nothing to show yet.                                                                        | 🔴 Gap — no evidence found      | [`requirements-traceability.md`](./requirements-traceability.md#gtic-software-reception-requirements) REQ-14                                                   |
| 10  | Product branding exists on main (EcoPlan header logo, partner carousel, /about). Still open: Gobierno Digital matrix, official PNNC mark rules, empty SIRAP logo slot.                                                                                                | 🟠 Parques IT decision required | [`requirements-traceability.md`](./requirements-traceability.md#gtic-software-reception-requirements) REQ-06                                                   |
| 11  | After the remaining layers and last-minute features are integrated, freeze the release candidate, then approve and execute the usability/UAT and performance-testing plans with assigned participants and environments.                                               | ⚪ Planned, not yet executed    | [`usability-testing.md`](./usability-testing.md), [`performance-testing.md`](./performance-testing.md)                                                         |
| 12  | Assign an engineering owner to verify and, if necessary, fix category-mask handling for arbitrary custom AOIs. The fixture drift is fixed. As of 2026-09-07 the suite under `backend/tests/` contains 165 tests. | 🟡 Team confirmation required   | [`performance-testing.md`](./performance-testing.md#backend-fixture-correction-and-remaining-production-concern)                                               |

> **Backend verification update:** A drifted synthetic raster fixture was corrected without weakening production validation. As of 2026-09-07 the suite under `backend/tests/` contains 165 tests. A separate production concern remains around category-mask consistency for arbitrary custom AOIs; see [`performance-testing.md`](./performance-testing.md#backend-fixture-correction-and-remaining-production-concern).

## Source documents this handoff responds to

- **GTIC-PNNC analysis**, "Análisis documento: Priorizando la Naturaleza-Colombia — Requisitos técnicos" (September 2025). GTIC's list of gaps to close before accepting the software.
- **"DISES MNP" presentation** (July 9, 2026). Project deliverables and open national-model/SIRAP/data/branding questions.

Full requirement-by-requirement coverage of both documents is in [`requirements-traceability.md`](./requirements-traceability.md).
