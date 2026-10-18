// GLL ID sign-in opens in a new tab. When that tab finishes, the original HT
// tab has to notice by itself: a BroadcastChannel message, with a localStorage
// `storage` event as the fallback (older Safari, storage-partitioned setups).

const CHANNEL = "ht_gate_signin";
const KEY = "ht_gate_signin_done";
const NEW_TAB_FLAG = "ht_gate_newtab";

/** Tell every other HT tab that a GLL ID sign-in just finished. */
export function notifySignedIn(): void {
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage("signed-in");
    ch.close();
  } catch {
    // No BroadcastChannel: the storage event below covers it.
  }
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage blocked: nothing more to try.
  }
}

/**
 * Calls `onSignedIn` once per sign-in done in another tab. Returns a function
 * that stops listening.
 */
export function listenSignedIn(onSignedIn: () => void): () => void {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    onSignedIn();
  };
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = fire;
  } catch {
    ch = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue) fire();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    ch?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/** Marks this tab as the one a GLL ID sign-in was opened in (survives the link step). */
export function markNewTab(): void {
  try {
    sessionStorage.setItem(NEW_TAB_FLAG, "1");
  } catch {
    // Storage blocked: the tab just behaves like a normal sign-in.
  }
}

export function isNewTab(): boolean {
  try {
    return sessionStorage.getItem(NEW_TAB_FLAG) === "1";
  } catch {
    return false;
  }
}

export function clearNewTab(): void {
  try {
    sessionStorage.removeItem(NEW_TAB_FLAG);
  } catch {
    // ignore
  }
}

/**
 * Opens the GLL ID flow in a new tab. False when the browser blocked it, so the
 * caller can fall back to navigating this tab.
 */
export function openInNewTab(url: string): boolean {
  try {
    const w = window.open(
      `${url}${url.includes("?") ? "&" : "?"}tab=1`,
      "_blank",
    );
    return w !== null && w !== undefined;
  } catch {
    return false;
  }
}

/** Full-page "You're signed in" notice for the new tab, in HT's modal style. */
export function showTabDone(message: string): void {
  const el = document.createElement("div");
  el.className =
    "fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-6";
  const box = document.createElement("div");
  box.className =
    "max-w-md w-full rounded-2xl border border-white/10 bg-[#0f172a] p-8 text-center text-white text-lg font-medium";
  box.setAttribute("role", "status");
  box.textContent = message;
  el.appendChild(box);
  document.body.appendChild(el);
  try {
    window.close();
  } catch {
    // The player closes the tab.
  }
}
