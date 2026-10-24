import { Features } from "./Features";
import { playerProfileUrl } from "./utilities/PlayerProfileUrl";

// Opens a player's public profile from the lobby roster or the win screen, in
// a new tab. The profile modal is a page: opening it here would replace the
// lobby page (or sit hidden behind the running game), so the lobby and the game
// stay where they are.
export function openPlayerProfile(publicId: string | undefined): void {
  if (!Features.profile || !publicId) return;
  window.open(playerProfileUrl(publicId), "_blank", "noopener");
}
