[← Back to E3-FO-35 documentation set](./README.md)

# Metrics API VM Runbook

This runbook sets up the Metrics API on a fresh virtual machine (VM), including the Blob URL Signing Service (`POST /downloads/signed-url`). It is written for the GTIC (Grupo de Tecnologías de Información y Comunicaciones) operator who will host the service.

The Metrics API is ready when the release tests pass against the new host:

```bash
DMT_TEST_SERVICE_URL=https://<api-host> npm run test:gate
```

Terms follow the [architecture glossary](../../../../architecture/glossary.md). The Private Layer Bucket is the Google Cloud Storage (GCS) bucket `pnn-priorizando-la-naturaleza`. The Download Catalog is the server-side list of file keys the service may sign.

Never paste key contents, tokens, or `.env` values into tickets, chat, logs, or this repository. Refer to variables by name only.

## What you need before you start

| Item | Who provides it | Used in |
| --- | --- | --- |
| A DNS name for the API, for example `api.<gtic-domain>` | GTIC | Step 3 and the release gate |
| The web address of the DISES Web App, for example `https://decision-making-tool-tau.vercel.app` | Spatial Lab | Step 5 (`DMT_CORS_ORIGINS`) and the bucket CORS rule |
| GCS signer key: JSON key for a service account with only Storage Object Viewer on the Private Layer Bucket | GTIC (bucket owner) | Step 6 |
| Firebase reader key: JSON key for a service account with only Firestore read access on the Firebase project | Firebase project owner (Spatial Lab today) | Step 6 |
| The repository commit to deploy | Spatial Lab | Step 4 |

See [Service-account keys](#service-account-keys) for how to create both keys with the smallest permissions.

## VM shape

| Setting | Value |
| --- | --- |
| Operating system | Ubuntu Server 22.04 or 24.04 LTS (long-term support), x86-64 |
| Size | Minimum 4 vCPU and 8 GB RAM. Recommended 8 vCPU and 16 GB RAM. See [system-administration.md](./system-administration.md#hardware-sizing). |
| Disk | At least 40 GB: about 20 GB of runtime artifacts plus the Docker image and OS |
| Inbound ports | `22` from the admin network only, `80` and `443` from anywhere. Do not expose `8000`. |
| Outbound | HTTPS (443) to the internet. The service calls `www.googleapis.com`, `oauth2.googleapis.com`, `firestore.googleapis.com`, and `aagibolq28slyfof.public.blob.vercel-storage.com`. Image builds also reach Docker Hub and PyPI. |
| Clock | NTP (Network Time Protocol) sync on. Signed links and token checks use the server clock. |

Block port `8000` in the cloud provider's firewall. Docker-published ports bypass `ufw` on the VM itself, so a `ufw` rule alone does not close it.

## Setup steps

Run every command on the VM unless the step says otherwise. Commands assume the repository lives at `/opt/dmt`.

1. **Check the clock.**

   ```bash
   timedatectl
   ```

   Expect `System clock synchronized: yes`. If not, run `sudo timedatectl set-ntp true`.

2. **Install Docker Engine and the Compose plugin**, then start Docker on boot so the container comes back after a reboot.

   Follow Docker's Ubuntu instructions (https://docs.docker.com/engine/install/ubuntu/), then:

   ```bash
   sudo systemctl enable --now docker
   docker compose version
   ```

3. **Install Caddy (a TLS reverse proxy) and point it at the API.** Follow https://caddyserver.com/docs/install#debian-ubuntu-raspbian, then replace `/etc/caddy/Caddyfile` with:

   ```text
   api.<gtic-domain> {
       reverse_proxy 127.0.0.1:8000
   }
   ```

   ```bash
   sudo systemctl reload caddy
   ```

   Caddy requests and renews the certificate automatically once the DNS name points at the VM and ports 80 and 443 are open. Use another reverse proxy if GTIC prefers; it only needs to terminate TLS and forward to `127.0.0.1:8000`.

4. **Get the code** at the commit Spatial Lab names.

   ```bash
   sudo git clone https://github.com/DISES-CI-UCSB/decision-making-tool.git /opt/dmt
   sudo chown -R "$USER" /opt/dmt
   cd /opt/dmt
   git checkout <release-commit>
   ```

5. **Create `backend/.env`** from the example and fill it in. See [Environment variables](#environment-variables).

   ```bash
   cp backend/.env.example backend/.env
   chmod 600 backend/.env
   nano backend/.env
   ```

   At minimum, set `DMT_CORS_ORIGINS` to the DISES Web App address. Keep the key-file and catalog paths from the example. Leave `FIREBASE_SERVICE_ACCOUNT_JSON` and `DMT_GCS_SERVICE_ACCOUNT_JSON` empty.

6. **Install the two keys as read-only files.** Compose mounts `backend/secrets/` read-only at `/run/secrets/dmt` inside the container. Copy each downloaded key to the VM (for example with `scp`), then:

   ```bash
   sudo install -d -m 0750 -o root -g 10001 backend/secrets
   sudo install -m 0440 -o root -g 10001 ~/firebase-reader-key.json backend/secrets/firebase-admin.json
   sudo install -m 0440 -o root -g 10001 ~/gcs-signer-key.json backend/secrets/gcs-signer.json
   shred -u ~/firebase-reader-key.json ~/gcs-signer-key.json
   ```

   Group `10001` is the container's `appuser`, so the files stay readable if the container later runs as that user. `backend/secrets/` is ignored by Git and by the Docker build, so keys never enter a commit or an image.

7. **Build the image and hydrate the runtime artifacts.** The first hydrate takes about 15 to 25 minutes.

   ```bash
   docker compose -f backend/docker-compose.yml build
   docker compose -f backend/docker-compose.yml run --rm backend hydrate
   ```

8. **Build the Download Catalog.** This merges the national 3.7.1 and SIRAP v7-endemic manifests from public Vercel Blob into `backend/runtime-artifacts/download-catalog.json`, which `DMT_DOWNLOAD_CATALOG_PATH` points at.

   ```bash
   docker compose -f backend/docker-compose.yml run --rm backend python -m scripts.build_download_catalog
   ```

   Expect a last line like `wrote /backend/runtime-artifacts/download-catalog.json: objects=4054 eje-cafetero=804 national=2926 orinoquia=324` (counts measured 11 November 2026). Any `conflicting=` count means a key is tagged with two regions; those keys are always refused. Report it to Spatial Lab.

   If Spatial Lab sends a catalog file instead, copy it to `backend/runtime-artifacts/download-catalog.json`. The service reloads the catalog when the file changes; no restart is needed.

9. **Start the service.**

   ```bash
   docker compose -f backend/docker-compose.yml up -d
   ```

10. **Check it on the VM.**

    ```bash
    curl -fsS http://127.0.0.1:8000/health
    curl -fsS http://127.0.0.1:8000/ready
    docker inspect --format '{{.State.Health.Status}}' "$(docker compose -f backend/docker-compose.yml ps -q backend)"
    curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8000/downloads/signed-url \
      -H 'content-type: application/json' \
      -d '{"object_name":"inputs/reference/ramsar/v0.1.0/ramsar.geojson"}'
    ```

    | Check | Pass | If it fails |
    | --- | --- | --- |
    | `/health` | HTTP 200 | `docker compose -f backend/docker-compose.yml logs --tail=100 backend` |
    | `/ready` | HTTP 200 | HTTP 503 means hydrate did not finish. Rerun step 7. |
    | Container health | `healthy` (may read `starting` for the first 15 seconds) | Same logs command |
    | Signed-url with no sign-in | `401` | `503` means a key file or the catalog is missing or unreadable. Recheck steps 5, 6, and 8. |

    The `401` proves the service found both key files and the catalog. It does not prove the keys have the right permissions; the release gate does.

11. **Check it through TLS** from any machine.

    ```bash
    curl -fsS https://api.<gtic-domain>/health
    ```

12. **Run the release gate** from a tester workstation, not the VM. See [Verification](#verification-release-gate).

13. **Turn on uptime monitoring.** See [Uptime](#uptime).

## Environment variables

Names only. Set them in `backend/.env` on the VM. Container paths are the defaults in [`backend/.env.example`](../../../../../backend/.env.example).

### Blob URL Signing Service

| Name | Set to | Required |
| --- | --- | --- |
| `DMT_FIREBASE_PROJECT_ID` | Firebase project id. Default `dises-decision-making-tool`. | Yes |
| `DMT_GCS_BUCKET` | Private Layer Bucket name. Default `pnn-priorizando-la-naturaleza`. | Yes |
| `DMT_DOWNLOAD_CATALOG_PATH` | `/backend/runtime-artifacts/download-catalog.json` | Yes |
| `DMT_FIREBASE_SERVICE_ACCOUNT_FILE` | `/run/secrets/dmt/firebase-admin.json` | Yes |
| `DMT_GCS_SERVICE_ACCOUNT_FILE` | `/run/secrets/dmt/gcs-signer.json` | Yes |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Leave empty. Deprecated inline key; a key file wins when both are set. | No |
| `DMT_GCS_SERVICE_ACCOUNT_JSON` | Leave empty. Deprecated inline key; a key file wins when both are set. | No |
| `DMT_GCS_SIGNED_URL_TTL_SECONDS` | Signed-link lifetime. Default `900`; capped at 7 days. The release tests expect 15 minutes. | No |
| `DMT_GCS_URL_CACHE_TTL_SECONDS` | Signed-link cache. Default `600`. | No |
| `DMT_AUTH_CACHE_TTL_SECONDS` | Token-check cache. Default `300`. | No |

### Metrics API

| Name | Set to | Required |
| --- | --- | --- |
| `DMT_CORS_ORIGINS` | DISES Web App address, comma-separated if more than one | Yes |
| `DMT_ARTIFACT_REQUIRED` | `true` | Yes |
| `DMT_ARTIFACT_DIR`, `DMT_ARTIFACT_MANIFEST` | Keep the example values | Yes |
| `DMT_SOLUTION_CACHE_DIR`, `DMT_CUSTOM_POLYGON_JOB_DB` | Keep the example values | Yes |
| `MANIFEST_BLOB_URL`, `DMT_MANIFEST_URL` | Hydrate recipe manifest. Keep the example values unless Spatial Lab names a new catalog. | Yes |
| `DMT_MESA_COVERAGE_REQUIRED`, `DMT_EXPECTED_COVERAGE_RELEASE_ID`, `DMT_EXPECTED_COVERAGE_CONTRACT_SHA256` | Keep the example values | No |
| `DMT_MAX_POLYGON_VERTICES`, `DMT_MAX_POLYGON_AREA_KM2`, `DMT_RATE_LIMIT_PER_MINUTE` | Keep the example values | No |
| `DMT_OPS_TOKEN` | Optional internal probe token. Leave empty unless Spatial Lab asks. | No |

The full Metrics API list is in [installation-configuration.md](./installation-configuration.md#backend-runtime).

## Service-account keys

The service uses two separate service accounts because Firebase and the Private Layer Bucket are in different Google Cloud projects. Each key is a JSON key file with a `private_key` and `client_email`.

### GCS signer key: Storage Object Viewer on the Private Layer Bucket only

`GcsV4Signer` in [`backend/app/downloads/signer.py`](../../../../../backend/app/downloads/signer.py) signs each link on the VM with the key's own private key (Google Cloud Storage V4 signing). It makes no Google API call to sign. So:

- The service account needs **no** IAM signing permission: no Service Account Token Creator role and no `iam.serviceAccounts.signBlob`.
- A **JSON key file is required.** Keyless options such as an attached VM service account or workload identity do not work with the current code, because they have no local private key.
- A signed link carries the service account's own access. Google checks `storage.objects.get` when someone opens the link. Grant **Storage Object Viewer** (`roles/storage.objectViewer`) on the bucket only, not on the project. It allows reading and listing objects, and nothing else.
- The bucket stays private. Do not add `allUsers` or `allAuthenticatedUsers`.

Request to GTIC, run by a bucket-project admin (replace `<project>`):

```bash
gcloud iam service-accounts create dmt-url-signer --project=<project> \
  --display-name="DISES Blob URL Signing Service"
gcloud storage buckets add-iam-policy-binding gs://pnn-priorizando-la-naturaleza \
  --member="serviceAccount:dmt-url-signer@<project>.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
gcloud iam service-accounts keys create gcs-signer-key.json \
  --iam-account="dmt-url-signer@<project>.iam.gserviceaccount.com"
```

If the organization policy `iam.disableServiceAccountKeyCreation` blocks the last command, GTIC needs an exception for this one service account.

### Firebase reader key: Firestore read only

The service verifies Firebase ID tokens with Google's public certificates, which needs no key. It uses the key only to read `users/{uid}` in Firestore. Grant **Cloud Datastore Viewer** (`roles/datastore.viewer`) on the Firebase project to a dedicated service account. Do not reuse the default Firebase Admin SDK account, which can write.

```bash
gcloud iam service-accounts create dmt-firestore-reader --project=dises-decision-making-tool \
  --display-name="DISES Metrics API Firestore reader"
gcloud projects add-iam-policy-binding dises-decision-making-tool \
  --member="serviceAccount:dmt-firestore-reader@dises-decision-making-tool.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"
gcloud iam service-accounts keys create firebase-reader-key.json \
  --iam-account="dmt-firestore-reader@dises-decision-making-tool.iam.gserviceaccount.com"
```

Firestore IAM cannot limit reads to one collection, so this role can read every Firestore document in the project. It cannot write.

### Rotating a key with overlap

Rotate each key at least yearly and whenever someone who held it leaves. The service notices a changed key file on the next request; no restart is needed.

1. Create a new key for the same service account. The old key keeps working.
2. Install it over the old file:

   ```bash
   sudo install -m 0440 -o root -g 10001 ~/gcs-signer-key.json backend/secrets/gcs-signer.json
   shred -u ~/gcs-signer-key.json
   ```

3. Run the release gate.
4. For the GCS signer key, wait at least `DMT_GCS_SIGNED_URL_TTL_SECONDS` (15 minutes by default). Links signed with the old key stop working the moment that key is disabled.
5. Disable the old key in IAM. Delete it a week later if nothing broke.

## Verification: release gate

The release tests are the acceptance check. Run them from a tester workstation with the repository checked out at the same commit as the VM:

```bash
npm ci
DMT_TEST_SERVICE_URL=https://api.<gtic-domain> npm run test:gate
```

In PowerShell:

```powershell
$env:DMT_TEST_SERVICE_URL = 'https://api.<gtic-domain>'
npm run test:gate
```

The gate needs the test-only Firebase Admin key on the workstation, at the repository root or at the path in `DMT_TEST_FIREBASE_ADMIN_KEY_FILE`. That key creates throwaway test accounts. It is a different key from the two on the VM and never goes on the VM. Other test overrides (`DMT_TEST_GCS_BUCKET` and the `DMT_TEST_*_OBJECT` names) are in [`tests/support/downloads/service-config.ts`](../../../../../tests/support/downloads/service-config.ts).

Pass means the command exits `0` and reports the release gate as passed. Do not send traffic to the new host until it does.

## Uptime

What is already in place:

- `restart: unless-stopped` in [`backend/docker-compose.yml`](../../../../../backend/docker-compose.yml) restarts the container after a crash, and after a reboot because step 2 enables Docker on boot.
- The image `HEALTHCHECK` in [`backend/Dockerfile`](../../../../../backend/Dockerfile) polls `/health` every 30 seconds and marks the container `unhealthy` after three failures.

Docker does not restart an `unhealthy` container by itself, and nothing above alerts a person. Add an external uptime check that emails or pages someone.

Recommended: a **Google Cloud Monitoring uptime check**, since GTIC already runs Google Cloud.

1. In the Google Cloud console, open Monitoring, then Uptime checks, then Create uptime check.
2. Protocol HTTPS, host `api.<gtic-domain>`, path `/health`, check every 5 minutes from at least three regions.
3. Create an alerting policy on that check that notifies the on-call email or chat channel.
4. Add a second check on `/ready`. A failing `/ready` with a passing `/health` means the artifacts are missing or broken, not that the process is down.

Any external monitor works if it alerts a named person, for example UptimeRobot or Better Stack. GTIC chooses the tool and the on-call contact.

## Dry run before handoff

Not run yet. It needs GTIC's GCS signer key and a fresh VM. Steps:

1. Create a throwaway Ubuntu VM with the [VM shape](#vm-shape) above.
2. Follow [Setup steps](#setup-steps) 1 to 10 exactly as written, with GTIC's GCS signer key and a Firebase reader key. Note the time each step takes and any command that needed changing.
3. If no DNS name is ready, skip steps 3 and 11. Open port `8000` to the tester's IP only, and run the gate with `DMT_TEST_SERVICE_URL=http://<vm-ip>:8000`.
4. Run the release gate. Record the result and total duration.
5. Fix this runbook wherever a step was wrong or missing.
6. Destroy the VM, then disable and delete the dry-run keys in IAM.

## GTIC handoff list

GTIC should complete these before go-live.

1. **Firebase email links, only if GTIC creates a new Firebase project.** Open a Google Support request to set the project's email action link target (`notification.sendEmail.callbackUri`) to the DISES Web App's `/auth/action` page, for example `https://<app-web-address>/auth/action`. Without it, Firebase email links, such as email verification, open the default Firebase page instead of the app. A new project also changes `DMT_FIREBASE_PROJECT_ID`, the frontend Firebase settings, and the Firebase settings in `tests/support/downloads/service-config.ts`.
2. **Bucket CORS rule for the DISES Web App address.** The browser will fetch signed links directly from `storage.googleapis.com`. CORS only lets that page read the response; the bucket stays private. Save as `cors.json` (replace the origin):

   ```json
   [
     {
       "origin": ["https://<app-web-address>"],
       "method": ["GET", "HEAD"],
       "responseHeader": ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
       "maxAgeSeconds": 3600
     }
   ]
   ```

   ```bash
   gcloud storage buckets update gs://pnn-priorizando-la-naturaleza --cors-file=cors.json
   gcloud storage buckets describe gs://pnn-priorizando-la-naturaleza --format="default(cors_config)"
   ```

3. **Least-privilege keys.** Issue the GCS signer key with only Storage Object Viewer on `pnn-priorizando-la-naturaleza`, as in [Service-account keys](#service-account-keys).
4. **Key rotation with overlap.** Rotate both keys on a schedule and when people leave, following [Rotating a key with overlap](#rotating-a-key-with-overlap). Rotate any key Spatial Lab held before step-down.
5. **Uptime alerting.** Choose the monitor and the on-call contact in [Uptime](#uptime).
6. **Release gate before go-live.** Run [Verification](#verification-release-gate) against the GTIC host. Point the DISES Web App at it only after the gate passes.
