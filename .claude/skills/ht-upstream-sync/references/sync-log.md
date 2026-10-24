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

## 2026-10-24: v0.35.3 (Major)

- Merged: 6070c060f (fixes up to fb49eea1a), rollback sha: 2168da6d5
- Conflicts: 18 files, all predicted; `LobbyPlayerView.levelBadge.test.ts` added to FORK_CHANGES.md.
- Surprises / new entry points hidden: upstream renamed `crazyGamesSDK` to `gamePortal`, so the Features guards had to be re-applied on the new names; `/users/@me` gained required fields (`steamLicence`, `steamLicenceSince`, `noticesSeen`); "Open Lobby Links in Steam" hidden via `Features.steam` in `canHandOffToSteam()`.
- Test or CI fixes needed: Features mocks in 5 new upstream tests; `userAuth` in AccountModalProgression's Auth mock (AdminResetCard calls it); `ht-ci.yml` format step moved to Oxfmt.
- Watch period result: shortened by Boss's override (daily rotation before Monday); see docs/Deploy.md.
- Lessons for conflicts.md or the skill: `gh` defaults to `upstream`, so pass `-R Gamble-Limited-Ltd/hostile-takeover`; never stash during a merge (it drops MERGE_HEAD).
