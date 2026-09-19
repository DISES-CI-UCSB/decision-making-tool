[← Back to handoff overview](../README.md)

# Service users and permissions

> **Status: repository-derived from `firestore.rules`, the in-app auth services, and the Firebase transfer checklist.** Cite this file on PNNC form E3-FO-35 as “Service users and their required permissions.” Do not treat email login as production identity. Firebase project Owner transfer to PNNC-GTIC is still pending.

This page is the operator view of **who may do what**. Day-2 hosting steps live in [`system-administration.md`](./system-administration.md). Account-approval procedure and Owner transfer steps live in the [Firebase project transfer checklist](../cybersecurity.md#firebase-project-transfer-checklist). UAT (User Acceptance Testing) role scripts are in [`usability-testing.md`](../usability-testing.md).

## Identity versus authorization

| Layer | What it answers | Where it lives |
| --- | --- | --- |
| **Identity** | Who is this Google account? | Firebase Authentication. Production path is Google sign-in. Auth hostname: `dises-decision-making-tool.firebaseapp.com`. |
| **Authorization** | What may this person do in EcoPlan? | Cloud Firestore documents, chiefly `users/{uid}`. Fields include `status`, `tier`, `role`, `isAdmin` / `isSuperAdmin`, `allowedSirapIds`, and `administeredSirapIds`. |

Signing in does not grant Decision Maker, Manager, SIRAP (Sistema Regional de Áreas Protegidas), or admin privileges. A person can authenticate and still remain on the public (Guest) product until a super-admin approves `accessRequests/{uid}` into an active `users/{uid}` record.

There are also two different “owner” roles. Parques needs both:

| Layer | What it controls | Where it lives |
| --- | --- | --- |
| Google Cloud / Firebase **project Owner** | Billing, authorized domains, Auth providers, Firestore rules deploys, exports, IAM (Identity and Access Management) | Firebase Console / Google Cloud IAM |
| In-app **super-admin** | Approve new accounts, assign staff roles, assign SIRAP regional admins | Cloud Firestore `users/{uid}` |

A regional SIRAP admin is an application role. Do not grant Google Cloud Owner to people who only need to approve regional access requests.

**TOTP** (Time-based One-Time Password) is a second factor from an authenticator app. The UI withholds Decision Maker and higher privileges until the signed-in user enrolls TOTP. Firestore rules require a TOTP second-factor claim for privileged reads and writes (admin, SIRAP administration, saved scenarios, publisher-style access). A Google session without TOTP stays on the public tier for those actions.

## Application roles

Product tiers on `users/{uid}` are integers: Guest / public = `1`, Decision Maker = `2`, Manager = `3`. Allowed `role` values in rules are `authorized_viewer`, `science_publisher`, and `admin`. Super-admin is also signaled by `isSuperAdmin: true` or `isAdmin: true`.

Only an in-app super-admin may create an approved `users/{uid}` record. Clients write `accessRequests/{uid}` as `pending` and wait.

| Role | How it is recognized | Can do | Cannot do |
| --- | --- | --- | --- |
| **Guest** | Not signed in, or signed in but not an active approved user | National Finder, map, AOI (Area of Interest), and analysis. The national product works without login. | Save named scenarios (those writes go to Firestore). See SIRAP catalogs. Open Access management. |
| **Pending** | Google sign-in plus `accessRequests/{uid}` with `status: pending`; no active `users/{uid}` | Same national capabilities as Guest. Submit or update their own pending access request. | Use Decision Maker saves, SIRAP catalogs, or admin tools. Signing in is not approval. |
| **Decision Maker / `authorized_viewer`** | Active user, `tier` 2 / `role: authorized_viewer` (and TOTP enrolled) | Guest capabilities plus save, rename, recall, and remove named solutions (maximum 12) in `users/{uid}/savedSolutionScenarios`. The left-sidebar label is what gets stored. Request Orinoquía and/or Eje Cafetero SIRAP data access. | See SIRAP catalogs until a region is granted. Open admin. Change anyone else’s roles. |
| **Manager / `science_publisher`** | Active user, `tier` 3 / `role: science_publisher` (and TOTP enrolled) | Decision Maker capabilities, plus the publisher-level product privilege that Firestore still checks (`hasManifestStyleAccess`). Assign this tier only to staff who should receive those privileges. | Approve new accounts, assign super-admins, or administer SIRAP regions unless they also hold those flags. The leftover manifest style-editor publisher is **not** a GTIC operator workflow. |
| **SIRAP user** | Active user whose `allowedSirapIds` contains at least one accepted region | SIRAP solutions for the granted region(s), plus Decision Maker saves. | Open admin. Use a region that was not granted. Administer anyone else. |
| **SIRAP regional admin** | Active user with `administeredSirapIds` set, and **not** a super-admin | See overlapping users (via `users` where SIRAP grants intersect, and `userDirectory`). Approve, deny, or revoke SIRAP **data** access (`allowedSirapIds`) **only** for administered regions. Decide matching `sirapAccessRequests`. | Approve brand-new Google / Firebase accounts. Appoint other SIRAP admins. Tick Super admin. Set app tier 2 versus 3. Administer a SIRAP they were not assigned. The Administrator-assignments UI is super-admin only. |
| **Super-admin** | Active user with `isSuperAdmin`, `isAdmin`, or `role: admin` (and TOTP enrolled) | Approve or deny new accounts into `users/{uid}`. Set Tier 2 versus Tier 3. Assign SIRAP regional admins (`administeredSirapIds`). Grant or revoke any accepted SIRAP. List access requests, users, and directory records. See all regions. | — |

Promote at least two Parques super-admins so one departure cannot lock the approval queue. Use Manager only for staff who need publisher-level privileges. Ordinary approved users are Decision Maker.

Account-level deny: mark `accessRequests/{uid}` as `denied` and do not leave that person as `users/{uid}` with `status: active`. If the in-app console has no account-deny control, a super-admin with Firestore Console access can set the request to `denied` and keep or set the user record inactive/denied.

## Firestore collections

Rules deny unmatched access by default. Client deletes are denied on these collections. Do not paste document contents into tickets.

| Collection | Purpose | Who can read | Who can write |
| --- | --- | --- | --- |
| `accessRequests/{uid}` | Pending or reviewed requests from people who signed in but are not yet approved | Self, or super-admin (list is super-admin only) | Self creates/updates a valid pending request. Super-admin updates status to `pending` / `approved` / `denied`. |
| `users/{uid}` | Approved user records: `status`, `tier`, `role`, admin flags, SIRAP grants | Self; super-admin; SIRAP regional admin when SIRAP grants overlap | Super-admin creates/updates a valid user record. Regional admin may change only `allowedSirapIds` for regions they administer. |
| `userDirectory/{uid}` | Directory listing used when a regional SIRAP admin cannot read every `users` document | Self, super-admin, or any SIRAP administrator | Super-admin create only. Updates and deletes denied. |
| `sirapAccessRequests/{uid}_{sirapId}` | Per-region SIRAP data-access requests | The requester, or someone who administers that `sirapId` | Requester creates a pending request (or re-requests after deny / lost grant). Administrator records approve/deny. |
| `users/{uid}/savedSolutionScenarios/{id}` | Signed-in users’ saved scenarios (user data; include in backups) | The owning user, with TOTP | The owning user, with TOTP. Fields: `id`, `solutionId`, `label` (1–80 chars), `solutionName`, `updatedAt`. |
| `mail` | Optional admin-notification documents | None from the client | None from the client. Rules `allow read, write: if false`. |

A leftover `manifestStyleRequests` collection still has rules for the retired style editor. It is not a GTIC operator workflow.

## Accepted SIRAP IDs

Eight SIRAP labels exist in the product. **Only Orinoquía and Eje Cafetero currently have published data**, and Firestore rules only accept these two IDs:

- `orinoquia`
- `eje-cafetero`

`allowedSirapIds` and `administeredSirapIds` must be lists of those values (at most six entries; the allowed set is still only those two). Assign regional admins by writing `administeredSirapIds` to one or both.

## Email login is a UI demo

Email login and email “request access” are **UI demos**. They are not connected to Firebase. Production identity is Google sign-in.

Testers or operators who avoid Google will see a dead email path. That is shipped product behavior, not a production authentication outage. Firestore still allows `provider` `local` on an access-request document shape; that does not make email login a production IdP (identity provider).

The Google sign-in service also contains a demo/stub fallback used only when Firebase is disabled. That fallback is not the production path.

## Service and runtime identities

These are platform and process credentials, not human EcoPlan roles. **Names only.** Never copy token values, service-account JSON, or private keys into this handoff, tickets, or chat. The Angular web config (`projectId` and other public client fields) is not a privileged secret. Treat Admin and write tokens as vault material.

| Name | Role | Required permission / use |
| --- | --- | --- |
| **Vercel** | Hosts and deploys the Angular SPA; may hold server env for the retired publisher | Project deploy, env-var custody, and preview/production domains. Confirm whether Parques will own this project. |
| **`BLOB_READ_WRITE_TOKEN`** | Vercel Blob read/write for publish and list scripts | Needed to publish or list objects. Public reads do not use this token. Never print the value. |
| **Firebase Admin** | Server-side token verification and privileged Firestore access (retired publisher path). Env names: `FIREBASE_SERVICE_ACCOUNT_JSON`, or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | Same Firebase project as the web app; Firestore access if that path is ever used. Rotate any key Spatial Lab held before step-down. |
| **`DMT_OPS_TOKEN`** | Shared secret for the metrics VM ops probe `GET /ops/custom-polygon` (`X-DMT-Ops-Token` header) | Operators who may see queue diagnostics. Unset or mismatch returns HTTP 404. Not a GTIC user-facing feature. |
| **`DMT_CORS_ORIGINS`** | Extra comma-separated frontend origins allowed by the metrics API CORS (Cross-Origin Resource Sharing) policy | Production and preview hosts are **not** allowed unless listed here (in addition to localhost defaults). Example shape: `https://decision-making-tool-tau.vercel.app`. |

Related non-secret configuration names (still vault the values): `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and the other Firebase web client fields; `MANIFEST_BLOB_URL`; `METRICS_API_BASE_URL`; backend artifact variables such as `DMT_ARTIFACT_DIR`. Full category list: [`architecture.md`](../architecture.md).

## Bootstrapping the first Parques super-admin

Follow the [Firebase project transfer checklist](../cybersecurity.md#firebase-project-transfer-checklist) — especially §1 (add Parques as project Owner), §5 (approve or deny users), and §6 (promote Parques staff). Summary only:

1. Add at least two Parques / PNNC-GTIC Google accounts as Google Cloud **Owner** on `dises-decision-making-tool`. Keep a Spatial Lab Owner until step-down checks pass.
2. Move billing to a Parques account before the last Spatial Lab Owner is removed.
3. Confirm authorized domains include the live frontend host, then have a Parques Owner complete Google sign-in on production (and localhost if required).
4. That person must **sign in once** so a Firebase Auth uid exists.
5. If Spatial Lab still has an in-app super-admin, that person promotes the first Parques staff account from Access management (tier, super-admin flag, SIRAP assignments).
6. If no in-app super-admin remains, a Firebase project Owner bootstraps the first Parques super-admin in Firestore Console on `users/{uid}`: `status: active`, `isSuperAdmin: true`, `isAdmin: true`, `role: admin`, `tier: 3`. Then that Parques super-admin promotes everyone else. Do not share that uid in this document.
7. Promote a second Parques super-admin. Have them approve a test access request and grant/revoke one SIRAP region before Spatial Lab steps down.

Regional SIRAP admins cannot complete step 6. They cannot create the first approved account.
