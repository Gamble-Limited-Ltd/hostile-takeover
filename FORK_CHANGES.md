# Fork changes

Every upstream (OpenFront) file that Hostile Takeover edits, and why. When an upstream merge
conflicts, use this list to put our edit back on top of upstream's version. New files that
only exist in the fork aren't listed.

| File                      | Change                                                                                         | Why                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `CLAUDE.md`               | Added the "Hostile Takeover" section at the top                                                | Fork rules, decisions, UI rules, upstream sync plan |
| `src/server/ServerEnv.ts` | Added `masterPort()` (reads `MASTER_PORT`, default 3000); workers listen on `masterPort()+1+i` | Dev ports collide with GLL on the shared VM         |
| `src/server/Master.ts`    | Listens on `ServerEnv.masterPort()` instead of 3000                                            | Same                                                |
| `vite.config.ts`          | Dev server port from `VITE_PORT` (default 9000), proxy targets from `MASTER_PORT`              | Same                                                |
| `example.env`             | Documented `MASTER_PORT` / `VITE_PORT`                                                         | Same                                                |
