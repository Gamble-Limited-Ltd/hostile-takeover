# Preship: the local gate

HT's gate is the same five checks as CI (`.github/workflows/ht-ci.yml`): typecheck, lint, Prettier, the
full test suite and `npm run build-prod`. On this VM that takes about 15 minutes. `preship.sh` runs
them in parallel, on the spare build PC when it is free (`buildpc-run`, private tool in
`~/gll-remotebuilder`), so a check takes about a minute (quick) or about 2.5 minutes (full).

```bash
bash preship.sh          # quick: for day-to-day work
bash preship.sh --full   # everything CI runs, on the offload PC only
bash preship.sh --status # is there a FULL pass for exactly this tree?
bash preship.sh --local  # never offload (quick on this VM; --full --local skips the build)
```

## Quick

- `typecheck` runs in full (`npm run typecheck`, so upstream changes to that script apply).
- `oxlint` and `eslint` (JS and TS files) and `prettier --check --ignore-unknown` (any file, so `.sh` and docs
  too) run on the changed files only; `vitest related --run`
  runs the tests that import a changed file (and a changed test file itself).
- "Changed" = committed on the branch since `merge-base HEAD origin/main`, staged, unstaged and
  untracked-not-ignored; deleted files drop out, a rename counts as its new name, `.nodeterm/` is ignored.
- A step with nothing to check prints `skipped: no changed files`.
- Light job: `buildpc-run --light --fallback local`. Not offloaded means it runs here instead.
- Quick does not replace CI. A change to `package.json`, the lockfile, `vite.config.ts`, an
  `eslint.config.js` or a tsconfig prints a reminder to run `--full`.

## Full

- Typecheck, `lint:oxlint`, `lint:eslint`, `prettier --check .`, `vitest run`, then
  `vitest run tests/server`, then `npm run build-prod` (after the tests, so it cannot write `static/`
  while they read the tree). Vitest runs with `--maxWorkers` set to cores minus 4 (2 to 8).
- Heavy job: `buildpc-run --heavy --fallback none`. When the PC is off, busy or paused it exits **75**
  with "push the branch, ht-ci.yml runs it for free". No fifteen-minute grind on the VM.
- The build only runs when `PRESHIP_BUILD=1`, which `preship.sh` sets for offloaded runs. It writes
  `static/` and `src/assets/` (both gitignored), but we still never run it in our own tree.
  The PC copy lives in `~/remotebuilder-work/`, outside this repo.
- Offloaded full runs delete `static/` before and after (on the PC copy only): a leftover
  `static/asset-hashes.json` from an earlier build makes `tests/server/RenderHtml.test.ts` fail. For the
  same reason `--full --local` on this VM fails that test while the VM has a `static/` build; CI is clean.
- The PC image is plain `node` and has no `jq`, so `tests/UpdateRegister.test.ts` (update.sh) is left
  out there, with a `NOTE:` in the output. CI runs it. Installing jq in the image would close the gap.
- If the only failing tests are `InventoryModal` ones, the output says so (known flaky timeouts under
  load, see CLAUDE.md). The run still fails; nothing is hidden.

## Result record and `--status`

After each run `preship.sh` writes one line per mode to `<git dir>/ht-preship-last` (never tracked):
mode, pass or fail, seconds, HEAD sha and a tree fingerprint (sha256 of HEAD, `git diff HEAD --binary` and
the hashes of untracked non-ignored files). `--status` exits 0 only when the last **full** run passed on a
tree with the same fingerprint, so any edit afterwards makes it stale. A quick pass never counts as a full pass.

## Files

| File                          | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `preship.sh`                  | Entry point: flags, offload decision, result record               |
| `scripts/preship-inner.sh`    | The checks; runs inside the container or locally                  |
| `scripts/preship-lib.sh`      | Pure helpers (changed files, filters, fingerprint, status)        |
| `.remotebuilder`              | Node from `.nvmrc`, npm 12.1.0, `npm run inst` on lockfile change |
| `tests/tools/Preship.test.ts` | Hermetic tests (temp git repos, stubbed `buildpc-run`/npm)        |

Exit codes: 0 pass, 1 a check failed, 2 bad usage, 75 not offloaded.
