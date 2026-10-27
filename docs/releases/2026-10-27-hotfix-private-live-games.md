# Release record: HT hotfix, live games and takeover in private lobbies (2026-10-27)

```
Release: root's live-games list and takeover now include private lobbies. Branch slice/at.9.
Lane: Hotfix (Boss, 2026-10-27: the admin tools shipped today never found a game, because the group
  plays private lobbies and the list was public-only). Boss runs the deploy with up.
What changed:
  - GameManager.startedGames() lists every started, not-ended game (was public only).
  - admin_takeover is authorized in any started multiplayer game (the public-only check is gone);
    the client offers it in any non-singleplayer game.
  - ToS and privacy: the admin may watch, and take over a computer player in, any match, public or
    private. Boss approved the wording in advance.
Gates: failing tests first (AdminLiveGames, AdminTakeover, TakeoverAction) [x]  targeted tests,
  typecheck, lint, format [x]  CI on slice/at.9 [x]  zero open P0/P1 [x]
  Not run: browser test (the prod logs showed the cause: every live_games call returned [] while the
  only running game was private lobby a6rXnpb3gB).
Player note: changelog line updated ("can watch any game").
Kill switches: HT_ADMIN_TAKEOVER=off, Features.adminTakeover.
Watch period: 2 h
Rollback: cd ~/hostile-takeover && ./ht-deploy.sh 3e07d5abef89623cb3250d4220f4e6c6188e99bb
```
