# Fork changes

Every upstream (OpenFront) file that Hostile Takeover edits, and why. When an upstream merge
conflicts, use this list to put our edit back on top of upstream's version. New files that
only exist in the fork aren't listed.

| File                                       | Change                                                                                         | Why                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `CLAUDE.md`                                | Added the "Hostile Takeover" section at the top                                                | Fork rules, decisions, UI rules, upstream sync plan                         |
| `src/server/ServerEnv.ts`                  | Added `masterPort()` (reads `MASTER_PORT`, default 3000); workers listen on `masterPort()+1+i` | Dev ports collide with GLL on the shared VM                                 |
| `src/server/Master.ts`                     | Listens on `ServerEnv.masterPort()` instead of 3000                                            | Same                                                                        |
| `vite.config.ts`                           | Dev server port from `VITE_PORT` (default 9000), proxy targets from `MASTER_PORT`              | Same                                                                        |
| `example.env`                              | Documented `MASTER_PORT` / `VITE_PORT`                                                         | Same                                                                        |
| `src/server/ServerEnv.ts`                  | Added `apiUrl()` (reads `API_URL`, trailing slash stripped); `jwtIssuer()` returns it when set | Free Cloudflare cert can't cover `api.<game domain>`; API gets its own host |
| `src/server/RenderHtml.ts`                 | Injects optional `apiUrl` into the bootstrap locals                                            | Client needs the same API URL                                               |
| `index.html`                               | Guarded `apiUrl` line in `BOOTSTRAP_CONFIG`                                                    | Same                                                                        |
| `packages/shared/src/configuration/Env.ts` | Optional `apiUrl` on `BOOTSTRAP_CONFIG` type                                                   | Same                                                                        |
| `src/client/ClientEnv.ts`                  | `apiUrl` value + `ClientEnv.apiUrl()`; `jwtIssuer()` prefers it                                | Same                                                                        |
| `src/client/ApiBase.ts`                    | `getApiBase()` returns `ClientEnv.apiUrl()` when set                                           | Same                                                                        |
| `vite.config.ts`                           | Dev template locals pass `apiUrl` from `API_URL`                                               | Same, in dev                                                                |
| `example.env`                              | Documented `API_URL`                                                                           | Same                                                                        |
