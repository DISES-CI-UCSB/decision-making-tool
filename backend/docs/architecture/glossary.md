# Architecture Glossary

_Status: Approved by the developer on 2026-10-16. Amended 2026-11-12: Download Catalog renamed Signable File Registry; Runtime Catalog and Runtime Catalog Release Index added._

Canonical names for architecture concepts. Use these names in diagrams, docs, interfaces, and new code. Aliases are older or informal names to retire in new writing.

## System and containers

| Term | Meaning | Aliases | Evidence |
| --- | --- | --- | --- |
| **DISES Web App** | The Angular single-page app that runs in the browser: map, layer panels, and dashboards. | Angular app | `frontend/` |
| **Metrics API** | The FastAPI backend container on the Digital Ocean virtual machine. It serves custom-polygon metrics and hosts the Blob URL Signing Service. | FastAPI metrics backend, metrics backend | `backend/app/main.py` |

## Runtime Catalog

| Term | Meaning | Aliases | Evidence |
| --- | --- | --- | --- |
| **Runtime Catalog** | The published JSON the DISES Web App loads to learn which layers, metadata files, metrics, and solutions exist, with a file address for each. Browser-facing; the app asks the Blob URL Signing Service for a link when a file is private. Not the same as the backend artifact manifest, which is an ops deployment artifact. | runtime layer manifest, runtime manifest, published manifests, layer manifest | `LayerManifestService`, `SolutionCatalogService` in `frontend/src/app/core/services/`; `docs/architecture/data-flow-and-blob-storage.md` |
| **Runtime Catalog Release Index** | The pointer file that names the current Runtime Catalog release. | catalog release index | `catalog-release-index.json`; `frontend/shared/runtime-manifest.constants.mjs` |

## Blob URL Signing Service

| Term | Meaning | Aliases | Evidence |
| --- | --- | --- | --- |
| **Blob URL Signing Service** | The Metrics API capability that turns a signed-in user's request into a short-lived signed GET link for one private layer file. "Blob" means one stored file object in the Private Layer Bucket, not Vercel Blob. | GCS download broker, secure download broker (UCS-232) | `backend/app/downloads/`; `GcsV4Signer` in `backend/app/downloads/signer.py` creates the signed GET link |
| **Download Broker** | The Blob URL Signing Service component that runs the checks in order (token, account, Signable File Registry, authenticator sign-in, region grant), caches the results, and requests the signed link. Names only this component, not the whole service. | — | `backend/app/downloads/broker.py` |
| **Signable File Registry** | The server-side registry of file keys the Blob URL Signing Service may sign, each tagged national or one SIRAP region. A file missing from it is denied. Built from the Runtime Catalog by `backend/scripts/build_download_catalog.py`. Holds access tags, not addresses. | Download Catalog | `ObjectCatalog`, `FileObjectCatalog`, and `MemoryObjectCatalog` in `backend/app/downloads/catalog.py` (code still uses the old name until UCS-373) |
| **Private Layer Bucket** | The GTIC-run Google Cloud Storage bucket `pnn-priorizando-la-naturaleza`, which holds layer files without public access. Separate from the public Vercel Blob store. | GTIC bucket | UCS-231 transfer |
| **Signed-In User** | A person with a Firebase session in the DISES Web App. Their access data lives in a Firestore user record, not in the session token. | — | `frontend/src/app/core/services/firebase-client.service.ts` |

Reason codes, not architecture concepts: `broker_not_configured` means the service is missing configuration and returns HTTP 503; `token_certs_unavailable` means Google's token certificates could not be fetched and returns HTTP 503.

## Testing

| Term | Meaning | Aliases | Evidence |
| --- | --- | --- | --- |
| **Test Sign-In Hook** | Build-time-only replacement for the Google popup's first-factor sign-in and re-authentication, used for disposable `@dmt-test.invalid` accounts. It exists only in the `e2e` Angular build configuration, which swaps the production stub for the hook; everything after the first factor (authenticator setup, the code screen, access rules) stays the app's real code. | — | `frontend/src/app/core/services/test-sign-in-hook.e2e.ts`; the `e2e` configuration in `frontend/angular.json`; FST-002 checks production builds leave it out |
