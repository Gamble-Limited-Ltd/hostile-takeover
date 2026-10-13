import { userAuth } from "./Auth";
import { isDesktopShell } from "./DesktopShell";
import { translateText } from "./Utils";

/**
 * Hostile Takeover has no guest play: without a session the client would fall
 * back to a raw persistent ID, which the production server refuses. On the web
 * we say so up front and open the account page instead of letting the join
 * fail. The desktop shell has its own gating (shouldBlockJoin).
 *
 * Pure so it is testable: `signedIn` is `(await userAuth()) !== false`.
 */
export function shouldRequireSignIn(
  desktopShell: boolean,
  gateable: boolean,
  signedIn: boolean,
): boolean {
  return !desktopShell && gateable && !signedIn;
}

/** Tells the player to sign in and opens the account page. */
export function promptSignIn(): void {
  window.dispatchEvent(
    new CustomEvent("show-message", {
      detail: {
        message: translateText("close_reason.login_required"),
        color: "red",
        duration: 3000,
      },
    }),
  );
  window.showPage?.("page-account");
}

/**
 * For a multiplayer entry point: true when the player is signed out (the
 * prompt has been shown and the caller should stop).
 */
export async function refuseIfSignedOut(
  beforePrompt?: () => void,
): Promise<boolean> {
  const signedIn = (await userAuth()) !== false;
  if (!shouldRequireSignIn(isDesktopShell(), true, signedIn)) return false;
  // Tear down any join UI first: closing a modal navigates back to the play
  // page, which would undo the account page the prompt opens.
  beforePrompt?.();
  promptSignIn();
  return true;
}
