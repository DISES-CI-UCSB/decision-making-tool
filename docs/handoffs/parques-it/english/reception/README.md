[← Back to handoff overview](../README.md)

# E3-FO-35 documentation set

Cite this folder on PNNC (Parques Nacionales Naturales de Colombia) form E3-FO-35, section **DOCUMENTATION**. GTIC (Grupo de Tecnologías de Información y Comunicaciones) asked for these files as part of formal software reception.

The Spanish end-user manual is still missing (REQ-16). Formal vulnerability analysis, SLA (Service Level Agreement), and license assignment are also still open.

| Document | Status | Location |
| --- | --- | --- |
| Installation/Configuration Manual | EXISTS | [installation-configuration.md](./installation-configuration.md) (also root `README.md`, `backend/README.md`, `frontend/README.md`, `.env.example`) |
| Technical Requirements Manual | EXISTS | [technical-requirements.md](./technical-requirements.md) (depth: [architecture.md](../architecture.md)) |
| System Administration Manual | EXISTS | [system-administration.md](./system-administration.md) (also [cybersecurity.md](../cybersecurity.md) and [data-operations/](../data-operations/)) |
| Entity Relationship Model | EXISTS | [data-model.md](./data-model.md) (Firestore ERD plus Blob/SQLite stores; not a raster 3NF model) |
| Performance testing protocol | EXISTS | [performance-testing.md](../performance-testing.md) (formal execution still pending) |
| Common problems and solutions | EXISTS | [faq-and-troubleshooting.md](./faq-and-troubleshooting.md#common-problems-and-solutions) |
| Frequently asked questions | EXISTS | [faq-and-troubleshooting.md](./faq-and-troubleshooting.md) |
| Hardware sizing study | EXISTS | [system-administration.md](./system-administration.md#hardware-sizing) plus [performance-results-2026-09-07.md](../performance-results-2026-09-07.md) |
| Service users and their required permissions | EXISTS | [service-users-and-permissions.md](./service-users-and-permissions.md) (also `firestore.rules`, [usability-testing.md](../usability-testing.md)) |
| Other | EXISTS | Source repository https://github.com/DISES-CI-UCSB/decision-making-tool.git |
| User Manual | MISSING | Role-based Spanish user guide (REQ-16) |
