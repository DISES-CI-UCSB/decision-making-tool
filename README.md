# Decision Making Tool — Workspace

A spatial conservation prioritization platform for Colombia. This repository is the working copy for two self-contained projects:

| Folder | Published to (Parques Nacionales Gitea) | Deployed as | Start here |
|--------|-----------------------------------------|-------------|------------|
| `frontend/` | `priorizando-naturaleza/frontend` | Static site (`yarn build:vercel`) | [frontend/README.md](frontend/README.md) |
| `backend/` | `priorizando-naturaleza/backend` | Docker container (`backend/Dockerfile`) | [backend/README.md](backend/README.md) |

Each folder is published as the root of its own Gitea repository and holds everything it needs: code, tests, `.env.example`, ignore files, and docs (English and Spanish). Nothing at this level is published.

## What lives at this level

| Path | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | GitHub CI for both folders |
| `.github/workflows/publish-gitea.yml`, `.github/scripts/publish-to-gitea.sh` | Publishes each folder to its Gitea repository |
| `.cursor/`, `.vscode/` | Editor and agent settings for this team |

## Run locally

Run each side from its own folder (see its README). The frontend (`yarn start`) calls the remote Metrics API by default; to use a local backend, run `docker compose up` in `backend/` and point the frontend's `proxy.conf.json` at it.

## Publishing to Gitea

`git subtree split` turns each folder's history into a standalone history with that folder at the root, then pushes it over SSH (port 23). The split is deterministic, so every publish is a plain fast-forward; the script never force-pushes. The target branch is `test` (where the CI/CD pipelines run); set `GITEA_BRANCH` to override.

```bash
bash .github/scripts/publish-to-gitea.sh all --dry-run
bash .github/scripts/publish-to-gitea.sh frontend
```

The GitHub Action does the same on every push to `main` that touches either folder, once the repository variable `GITEA_PUBLISH_ENABLED` is `true` and the secrets `GITEA_SSH_PRIVATE_KEY` and `GITEA_SSH_KNOWN_HOSTS` exist.

The archived R Shiny app lives in git history at the `legacy-r-shiny-app-final` tag.
