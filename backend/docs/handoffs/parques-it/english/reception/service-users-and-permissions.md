[← Back to handoff overview](../README.md)

# Service users and permissions

> **Status: repository-derived from `firestore.rules`, the in-app auth services, and the Firebase transfer checklist.** Cite this file on PNNC form E3-FO-35 as “Service users and their required permissions.” Do not treat email login as production identity. Firebase project Owner transfer to PNNC-GTIC is still pending.

This page is the operator view of **who may do what**. Day-2 hosting steps live in [`system-administration.md`](./system-administration.md). Account-access procedure and Owner transfer steps live in the [Firebase project transfer checklist](../cybersecurity.md#firebase-project-transfer-checklist). UAT (User Acceptance Testing) role scripts are in [`usability-testing.md`](../usability-testing.md).

## Identity versus authorization

| Layer | What it answers | Where it lives |
| --- | --- | --- |
| **Identity** | Who is this Google account? | Firebase Authentication. Production path is Google sign-in. Auth hostname: `dises-decision-making-tool.firebaseapp.com`. |
| **Authorization** | What may this person do in EcoPlan? | Cloud Firestore documents, chiefly `users/{uid}`. Fields include `status`, `tier`, `role`, `allowedSirapIds`, `administeredSirapIds`, and `mfaEnrolledAt`. |

Signing in does not grant Decision Maker, SIRAP (Sistema Regional de Áreas Protegidas), or admin privileges. A person's first Google sign-in creates their own default user record (Standard user, no regions) without anyone approving it. They stay on the public (Guest) product until they set up an authenticator. Super-admins and regional admins then widen their access by changing the role or granting SIRAP regions.

There are also two different “owner” roles. Parques needs both:

| Layer | What it controls | Where it lives |
| --- | --- | --- |
| Google Cloud / Firebase **project Owner** | Billing, authorized domains, Auth providers, Firestore rules deploys, exports, IAM (Identity and Access Management) | Firebase Console / Google Cloud IAM |
| In-app **super-admin** | Assign roles and SIRAP regions, appoint SIRAP regional admins, reset lost authenticators | Cloud Firestore `users/{uid}` |

A regional SIRAP admin is an application role. Do not grant Google Cloud Owner to people who only need to approve regional access requests.

**TOTP** (Time-based One-Time Password) is a second factor from an authenticator app: a time-based 6-digit code. Every new person must set up an authenticator at first sign-in before getting any access beyond the public product. Firestore rules require a TOTP second-factor claim for privileged reads and writes (admin, SIRAP administration, SIRAP access requests, saved scenarios). A Google session without TOTP stays on the public tier for those actions.

### If an authenticator disappears after setup

Some organizations' email security tools open every link in an email. According to the app's own notice, the email sent after setup contains a link that undoes the change, so a scanner opening it removes the authenticator. When a person who finished setup signs in and Firebase holds no authenticator, EcoPlan shows a notice that their organization's email security probably removed it. The notice offers immediate setup of a new authenticator, so no super-admin is needed. It also asks them to have their IT team exclude links to `dises-decision-making-tool.firebaseapp.com` from link scanning. EcoPlan knows setup finished because the person's own record holds `mfaEnrolledAt`, the server time of the confirmed setup. It is the only field the record's owner may write, and only from a sign-in that used an authenticator.

## Application roles

Roles on `users/{uid}` are `user` (shown as Standard user), `sirap-user`, `sirap-admin`, and `super-admin`. Rules tie each role to the person's regions: `user` holds none, `sirap-user` holds at least one in `allowedSirapIds`, `sirap-admin` administers at least one region and also holds it, and `super-admin` is unrestricted. The product tier follows the role: Guest / public = `1`, Decision Maker = `2` for every role except super-admin, and Manager = `3` for super-admin only. Older records may still carry the retired values `authorized_viewer`, `science_publisher`, or `admin`, or `isSuperAdmin: true` / `isAdmin: true`; the web app and the Metrics API read `admin` and those flags as super-admin.

A Google-signed-in person may create only their own default user record: `role: user`, `tier: 2`, `status: active`, and no regions. Nobody can approve themselves, admins included. Only super-admins change roles and account status. Clients no longer write `accessRequests/{uid}`; account approval no longer exists.

| Role | How it is recognized | Can do | Cannot do |
| --- | --- | --- | --- |
| **Guest** | Not signed in, signed in with an account that is not active (`status: denied`), or signed in without a set-up authenticator | National Finder, map, AOI (Area of Interest), and analysis. The national product works without login. | Save named scenarios (those writes go to Firestore). See SIRAP catalogs. Open Access management. |
| **Awaiting authenticator setup** | Google sign-in plus the default `users/{uid}` record, with no authenticator yet | Same national capabilities as Guest. Set up an authenticator. | Use Decision Maker saves, SIRAP catalogs, or admin tools until setup finishes. |
| **Decision Maker (Standard user)** | Active user, `tier` 2 / `role: user`, authenticator set up | Guest capabilities plus save, rename, recall, and remove named solutions (maximum 12) in `users/{uid}/savedSolutionScenarios`. The left-sidebar label is what gets stored. Request Orinoquía and/or Eje Cafetero SIRAP data access. | See SIRAP catalogs until a region is granted. Open admin. Change anyone else’s roles. |
| **SIRAP user** | Active user, `role: sirap-user`, whose `allowedSirapIds` contains at least one accepted region | SIRAP solutions for the granted region(s), plus Decision Maker saves. | Open admin. Use a region that was not granted. Administer anyone else. |
| **SIRAP regional admin** | Active user, `role: sirap-admin`, with `administeredSirapIds` set, and **not** a super-admin | List active users who hold an administered SIRAP. Read an active user who has a pending request for one. Decide matching `sirapAccessRequests`, except their own approval. Grant a region only to someone who already holds one of theirs or has a pending request for that region. Revoke a region **only** for administered regions. | Change a role directly (a grant or revoke moves someone between Standard user and SIRAP user because the role must match their regions). Appoint SIRAP admins or super-admins. Reset authenticators. Administer a SIRAP they were not assigned. The Administrator-assignments UI is super-admin only. |
| **Super-admin** | Active user, `role: super-admin` (older records: `isSuperAdmin`, `isAdmin`, or `role: admin`), tier 3, authenticator set up | Change any active user's role and regions. Assign SIRAP regional admins (`administeredSirapIds`) and other super-admins. Grant or revoke any accepted SIRAP and decide any SIRAP request except their own. List users and directory records. Reset another person's lost authenticator. See all regions. | Approve their own SIRAP request. Reset their own authenticator. |

Tier 3 (Manager) belongs to super-admins only. The earlier separate Manager role (`science_publisher`) is retired. The leftover manifest style-editor publisher is **not** a GTIC operator workflow.

Promote at least two Parques super-admins so one departure cannot lock role changes and authenticator resets.

Account-level block: set `users/{uid}.status` to `denied`. The Admin console has no control for it, so a super-admin or a project Owner does it in Firestore Console. The person's next sign-in ends with an “account is not active” message. Do not leave someone you mean to block as `status: active`.

## Resetting a lost authenticator

A person who loses, wipes, or replaces the phone with their authenticator app cannot get past the code screen. A super-admin resets their authenticator. The person then sets up a new one at their next sign-in. Their role, tier, and SIRAP grants do not change.

### 1. Verify the person's identity first

Anyone can write in claiming to be a staff member. A reset hands the account to whoever signs in next, so confirm the request really comes from the account owner. Use one of these:

- **A reply from their registered email address.** Write to the address shown in Access management and ask them to reply. Do not rely on a message they sent first, and do not send a link for them to click; a reply proves they control the mailbox.
- **A phone or video call** with someone you recognize, or through a number from the Parques staff directory (not one given in the request).

If neither works, do not reset. Record who verified the request and how in your ticket. Do not paste the person's uid or any codes into the ticket.

### 2. Reset it in the Admin console

1. Sign in as a super-admin with your own authenticator code.
2. Select **Admin console** in the header, then the **Active Users** tab.
3. Search for the person's email and expand their card.
4. In **Lost authenticator**, select **Reset authenticator**.
5. The confirmation repeats the identity check. Select **OK** only after you have verified them.
6. The card shows **Authenticator reset.** If it shows an error, nothing was changed; follow its wording (for example, sign out and back in with your own code).

The Spanish interface labels are **Consola de administración**, **Restablecer autenticador**, and **Autenticador restablecido**.

### 3. What the person sees next

- They are signed out on every device. Codes from the old authenticator stop working.
- At their next Google sign-in, EcoPlan shows the setup screen with a new QR code instead of the code screen. They scan it with their authenticator app and enter the 6-digit code.
- After that they have their usual access again. Later sign-ins ask for codes from the new authenticator only.

Two limits are worth knowing. Signed download links issued before the reset keep working until they expire (15 minutes by default). The Metrics API also forgets the person's cached sign-in on reset, but only inside the container that handled the reset; the current VM runs one container, so keep it that way or plan for up to 5 minutes of old-session downloads.

### Rules for super-admin accounts

- **Nobody can reset their own authenticator.** The button is hidden on your own card, and the Metrics API refuses the request. A stolen super-admin session must not be able to swap in the thief's authenticator.
- **A super-admin who loses theirs asks another super-admin** to verify them and reset it. Keep at least two Parques super-admins for this reason.
- Only an active super-admin who signed in with an authenticator code can reset anyone. Regional SIRAP admins cannot.

### If the last super-admin is locked out

When no other super-admin can sign in, a Firebase **project Owner** removes the authenticator from a workstation with the repository checked out. Verify the person first, exactly as above.

```bash
cd frontend
gcloud auth application-default login   # sign in as the project Owner; or set FIREBASE_SERVICE_ACCOUNT_JSON
yarn reset:totp -- person@example.org
```

The script removes every enrolled second factor and signs the person out everywhere. It prints the email, uid, and `remainingFactors`; expect `0`. Do not paste that output into a ticket. Because the script does not go through the Metrics API, a session that already downloaded something can keep getting download links for up to 5 minutes (`DMT_AUTH_CACHE_TTL_SECONDS`).

## Firestore collections

Rules deny unmatched access by default. Client deletes are denied on these collections. Do not paste document contents into tickets.

| Collection | Purpose | Who can read | Who can write |
| --- | --- | --- | --- |
| `accessRequests/{uid}` | Retired account-approval requests. Old documents stay stored. | Nobody from the client | Nobody from the client. Rules `allow read, write: if false`. |
| `users/{uid}` | User records: `status`, `tier`, `role`, SIRAP grants, `mfaEnrolledAt` | Self; super-admin; SIRAP regional admin. A regional admin lists only active users who hold an administered SIRAP (the query must filter on one) and reads an active user with a pending request for one. | A Google-signed-in person creates only their own default record. Super-admin creates/updates a valid user record (roles, status, regions). Regional admin may change only `allowedSirapIds` (and the role and tier that follow) for regions they administer, only for someone who holds one of their regions or has a pending request for the region granted. The owner may write only `mfaEnrolledAt`. |
| `userDirectory/{uid}` | Name and email row for each active user | Self or super-admin | Only the person creates their own row, at sign-in while their account is active. Super-admins cannot write it. `yarn backfill:user-directory` (an admin script that bypasses rules) adds missing rows. Updates and deletes denied. The Admin console writes nothing when it opens. |
| `sirapAccessRequests/{uid}_{sirapId}` | Per-region SIRAP data-access requests | The requester, or someone who administers that `sirapId` | Requester creates a pending request with an authenticator sign-in (or re-requests after deny / lost grant). Administrator records approve/deny; nobody can approve their own request. |
| `users/{uid}/savedSolutionScenarios/{id}` | Signed-in users’ saved scenarios (user data; include in backups) | The owning user, with TOTP | The owning user, with TOTP. Fields: `id`, `solutionId`, `label` (1–80 chars), `solutionName`, `updatedAt`. |
| `mail` | Reserved for admin-notification documents; nothing in the app writes it now | None from the client | None from the client. Rules `allow read, write: if false`. |

A leftover `manifestStyleRequests` collection still has rules for the retired style editor. It is not a GTIC operator workflow.

## Accepted SIRAP IDs

Eight SIRAP labels exist in the product. **Only Orinoquía and Eje Cafetero currently have published data**, and Firestore rules only accept these two IDs:

- `orinoquia`
- `eje-cafetero`

`allowedSirapIds` and `administeredSirapIds` must be lists of those values (at most six entries; the allowed set is still only those two). Assign regional admins by writing `administeredSirapIds` to one or both.

## Email login is not offered

The sign-in dialog states that a Google account is required and email and password sign-in is not available. Production identity is Google sign-in. Firestore rules also refuse a first user record from any other sign-in provider, because open email and password signup would not prove the email belongs to the caller.

The Google sign-in service also contains a demo/stub fallback used only when Firebase is disabled. That fallback is not the production path.

## Service and runtime identities

These are platform and process credentials, not human EcoPlan roles. **Names only.** Never copy token values, service-account JSON, or private keys into this handoff, tickets, or chat. The Angular web config (`projectId` and other public client fields) is not a privileged secret. Treat Admin and write tokens as vault material.

| Name | Role | Required permission / use |
| --- | --- | --- |
| **Vercel** | Hosts and deploys the Angular SPA; may hold server env for the retired publisher | Project deploy, env-var custody, and preview/production domains. Confirm whether Parques will own this project. |
| **`BLOB_READ_WRITE_TOKEN`** | Vercel Blob read/write for publish and list scripts | Needed to publish or list objects. Public reads do not use this token. Never print the value. |
| **`dmt-metrics-api-firebase`** (service account) | The Metrics API's own Firebase key: reads `users/{uid}`, checks each sign-in's Firebase Authentication account, and resets lost authenticators. Key file named by `DMT_FIREBASE_SERVICE_ACCOUNT_FILE`. | **Firebase Authentication Admin** and **Cloud Datastore User** on the Firebase project, nothing more. Do not reuse the default Firebase Admin SDK account. See the [Metrics API VM runbook](./metrics-api-vm-runbook.md#service-account-keys). |
| **Firebase Admin** | Server-side token verification and privileged Firestore access (retired publisher path). Env names: `FIREBASE_SERVICE_ACCOUNT_JSON`, or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | Same Firebase project as the web app; Firestore access if that path is ever used. Rotate any key Spatial Lab held before step-down. |
| **`DMT_OPS_TOKEN`** | Shared secret for the metrics VM ops probe `GET /ops/custom-polygon` (`X-DMT-Ops-Token` header) | Operators who may see queue diagnostics. Unset or mismatch returns HTTP 404. Not a GTIC user-facing feature. |
| **`DMT_CORS_ORIGINS`** | Extra comma-separated frontend origins allowed by the metrics API CORS (Cross-Origin Resource Sharing) policy | Production and preview hosts are **not** allowed unless listed here (in addition to localhost defaults). Example shape: `https://decision-making-tool-tau.vercel.app`. |

Related non-secret configuration names (still vault the values): `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and the other Firebase web client fields; `MANIFEST_BLOB_URL`; `METRICS_API_BASE_URL`; backend artifact variables such as `DMT_ARTIFACT_DIR`. Full category list: [`architecture.md`](../architecture.md).

## Bootstrapping the first Parques super-admin

Follow the [Firebase project transfer checklist](../cybersecurity.md#firebase-project-transfer-checklist) — especially §1 (add Parques as project Owner), §5 (how accounts get access), and §6 (promote Parques staff). Summary only:

1. Add at least two Parques / PNNC-GTIC Google accounts as Google Cloud **Owner** on `dises-decision-making-tool`. Keep a Spatial Lab Owner until step-down checks pass.
2. Move billing to a Parques account before the last Spatial Lab Owner is removed.
3. Confirm authorized domains include the live frontend host, then have a Parques Owner complete Google sign-in on production (and localhost if required).
4. That person must **sign in once** and set up an authenticator. The first sign-in creates their default `users/{uid}` record.
5. If Spatial Lab still has an in-app super-admin, that person promotes the first Parques staff account from Access management by choosing the **Super admin** role.
6. If no in-app super-admin remains, a Firebase project Owner bootstraps the first Parques super-admin by editing that person's existing `users/{uid}` record in Firestore Console: `role: super-admin`, `tier: 3`, `status: active`. Then that Parques super-admin promotes everyone else. Do not share that uid in this document.
7. Promote a second Parques super-admin. Have them decide a test SIRAP access request from a second test account and grant/revoke one SIRAP region before Spatial Lab steps down.

Regional SIRAP admins cannot complete step 6. They cannot make anyone a super-admin.
