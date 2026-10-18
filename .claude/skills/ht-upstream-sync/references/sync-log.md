# Sync log

One entry per upstream sync, newest first. Record what surprised us so the next sync is cheaper.
Template:

```
## YYYY-MM-DD: v0.NN.N (Minor|Major)
- Merged: <sha>, rollback sha: <sha>
- Conflicts: <n> files; any not in FORK_CHANGES.md
- Surprises / new entry points hidden:
- Test or CI fixes needed:
- Watch period result:
- Lessons for conflicts.md or the skill:
```

## Baseline before the first sync (2026-10-18)

- Dry run to v0.35.2: 76 upstream commits to take, 91 of ours since the merge base (2026-10-10), 17 predicted conflicts, all client UI/auth plus two tests. Only `tests/client/components/LobbyPlayerView.levelBadge.test.ts` is missing from `FORK_CHANGES.md`.
- Engine, shared schemas, two workflows (`cherry-pick-milestone.yml`, `ci.yml`) and dependencies all change, so the first sync is a **Major**. The first sync is planned for later.
