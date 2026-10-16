# Architecture Glossary

_Status: Draft, pending developer approval (2026-10-15)._

Canonical names for architecture concepts. Use these names in diagrams, docs, interfaces, and new code. Aliases are older or informal names to retire in new writing.

## System and containers

| Term | Meaning | Aliases | Evidence |
| --- | --- | --- | --- |
| **DISES Web App** | The Angular single-page app that runs in the browser: map, layer panels, and dashboards. | Angular app | `frontend/` |
| **Metrics API** | The FastAPI backend container on the Digital Ocean virtual machine. It serves custom-polygon metrics and hosts the Blob URL Signing Service. | FastAPI metrics backend, metrics backend | `backend/app/main.py` |

## Blob URL Signing Service

| Term | Meaning | Aliases | Evidence |
| --- | --- | --- | --- |
| **Blob URL Signing Service** | The Metrics API capability that turns a signed-in user's request into a short-lived signed GET link for one private layer file. "Blob" means one stored file object in the Private Layer Bucket, not Vercel Blob. | GCS download broker, secure download broker (UCS-232) | `backend/app/downloads/` |
| **Download Broker** | The Blob URL Signing Service component that runs the checks in order (token, account, catalog, authenticator sign-in, region grant), caches the results, and requests the signed link. Names only this component, not the whole service. | — | `backend/app/downloads/broker.py` |
| **Download Catalog** | The server-side list of file keys the service may sign, each tagged national or one SIRAP region. A file missing from it is denied. | — | `backend/app/downloads/catalog.py` |
| **Private Layer Bucket** | The GTIC-run Google Cloud Storage bucket `pnn-priorizando-la-naturaleza`, which holds layer files without public access. Separate from the public Vercel Blob store. | GTIC bucket | UCS-231 transfer |
| **Signed-In User** | A person with a Firebase session in the DISES Web App. Their access data lives in a Firestore user record, not in the session token. | — | `frontend/src/app/core/services/firebase-client.service.ts` |
