# Build and restart speed

Why the Docker build and `./ht-deploy.sh` are quicker than they were, and what to keep intact.

## What changed (offload slice 3)

- **`Dockerfile` build stage no longer declares `GIT_COMMIT`.** Nothing in `npm run build-prod` reads it,
  but an `ARG`/`ENV` placed before that step is part of the layer's cache key, so every commit (even a
  docs-only one) re-ran `tsc` + `vite build`. The final stage still stamps `static/commit.txt` and the
  `GIT_COMMIT` env. Measured on the VM: a commit-only rebuild went from 80 s to 8 s. A real source change
  still costs the 65 s client build.
- **`start_interval: 2s` on the api and game healthchecks** (`docker-compose.prod.yml`). During
  `start_period` Docker now probes every 2 s instead of every 15 s, so a container is seen as healthy
  within seconds of being ready. `interval`, `retries` and `start_period` are unchanged, so failure
  detection is the same.
- `tests/tools/DockerCache.test.ts` guards both, so a later edit can't quietly bring the slow path back.

## Rules for editing the Dockerfile

- Do not add `ARG GIT_COMMIT` / `ENV GIT_COMMIT` to the `build` stage. If the client ever needs the
  commit at build time, pass it to that stage only after measuring the cost.
- Keep `COPY package*.json` and the `npm ci` cache mount ahead of the source copies.
- `.dockerignore` already keeps `tests/`, `plans/`, `.git` and secrets out of the context (about 270 kB).

## Not done here

- Moving the 65 s client build to the spare PC (BuildKit cache shared between hosts) is slice 6 of the
  offload plan (`~/gll-remotebuilder`).
