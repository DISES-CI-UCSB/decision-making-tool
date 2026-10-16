# TEMPORARY — delete after UCS-232 is deployed and its live tests pass

Handoff prompt for the next agent session. Paste everything below the line into a new chat.

---

Continue UCS-232 (Blob URL Signing Service, supersedes UCS-192) on branch `blob-signing-service`. Goal: deploy the service to the Digital Ocean VM and get the five live Feature Behavior Tests (FBT-001..005) passing. Act as the orchestrating agent and use Opus sub-agents for VM and test work.

## What exists (committed in `cd79ba13`)

- Service: `backend/app/downloads/*`, route `POST /downloads/signed-url` in the FastAPI Metrics API. Returns a GCS (Google Cloud Storage) V4 signed GET URL. 30 offline pytest tests in `backend/tests/test_download_broker.py`.
- Access rule: national files need any active account; SIRAP (Sistema Regional de Áreas Protegidas) files (`orinoquia`, `eje-cafetero`) need authenticator (TOTP) sign-in plus the region grant; super-admin gets both regions. Roles come from Firestore `users/{uid}`, not the token.
- Test system at repo root (Vitest + Playwright, catalog `tests/support/catalog/test-catalog.json`). Live tests: `tests/features/FS-200-private-layer-downloads/`. Helpers: `tests/support/downloads/`.
- Draft glossary `docs/architecture/glossary.md` — still pending developer approval.
- C4 doc in Linear: "Blob URL Signing Service" (DISES project).

## Setup on the new computer

1. `git checkout blob-signing-service` then `npm install` at repo root.
2. Copy the Firebase Admin key JSON into the repo root (gitignored), or set `DMT_TEST_FIREBASE_ADMIN_KEY_FILE`. Never print key or token values.
3. Confirm `ssh -o BatchMode=yes -o ConnectTimeout=10 root@107.170.64.162 "echo ok"` works. (The old PC had a local firewall rule "Block SSH Connections" on `ssh.exe`.)
4. Offline sanity check: `npm run test:shared` (SST-001/002 pass; FBT-001..005 show NOT RUN).

## Remaining work, in order

1. **VM recon, read-only.** Inspect the repo checkout, `docker-compose.yml`, root `.env` and `backend/.env` (names only), running containers, and how the API is served at `https://api.decision-making-support-tool.xyz`. Report findings and ask before changing anything.
2. **Deploy (after approval).** Pull the branch; add the download catalog JSON; place the Firestore reader key and the GCS signer key in a read-only directory readable only by the container user; set the `DMT_` env vars; add a read-only key mount in Docker Compose; rebuild. Smoke check: no token returns 401; a 503 `broker_not_configured` means config is missing.
3. **Verify catalog object keys** in `tests/support/downloads/service-config.ts` (national, orinoquia, ejeCafetero, unlisted). All four are unverified guesses; confirm against bucket `pnn-priorizando-la-naturaleza` and the VM catalog.
4. **Run live tests:** `npm run test:feature-set -- FS-200`. They create throwaway Firebase users (`dmt-test-…@dmt-test.invalid`) and delete them in `afterAll`; confirm cleanup. Unknowns: TOTP MFA enabled on the Firebase project, `.invalid` emails accepted, clock skew (FBT-001 expects expiry 14–16 min ahead).
5. **Follow-ups:** optionally propose pytest tests for the new 503 `token_certs_unavailable` and 7-day link-lifetime cap (permanent tests need approval); get glossary approval and sync terms (`ObjectCatalog`, `GcsV4Signer`, `broker_not_configured`); ask GTIC for a read-only signer service account (the current bucket key can write).

## Rules to follow

- Ask before any VM change, commit, or new/changed permanent test.
- Never update test expectations to match live output.
- Uncommitted on the old PC, unrelated to this work: Windows fixes in `data/metrics/python/metrics_pipeline/` (`raster_align.py`, `species_overlap.py`). Not on this branch.
