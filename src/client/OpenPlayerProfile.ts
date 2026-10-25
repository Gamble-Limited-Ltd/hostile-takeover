import { getApiBase } from "./ApiBase";
import { Features } from "./Features";
import { playerProfileUrl } from "./utilities/PlayerProfileUrl";

// Opens a signed-in player's public profile from the lobby roster or the win
// screen, in a new tab, by account username (signed-in players always play
// under it). The profile modal is a page: opening it here would replace the
// lobby page (or sit hidden behind the running game), so the lobby and the
// game stay where they are. The tab opens on the click, so popup blockers
// allow it, and moves to the profile once the API names the publicId; an
// unknown name closes it again.
export function openPlayerProfile(username: string | undefined): void {
  if (!Features.profile || !username) return;
  const tab = window.open("", "_blank");
  if (tab === null) return;
  tab.opener = null;
  void (async () => {
    try {
      const res = await fetch(
        `${getApiBase()}/public/player/by-username/${encodeURIComponent(username)}`,
      );
      const body = res.ok ? await res.json() : null;
      if (typeof body?.publicId !== "string") throw new Error("no profile");
      tab.location.href = playerProfileUrl(body.publicId);
    } catch {
      tab.close();
    }
  })();
}
