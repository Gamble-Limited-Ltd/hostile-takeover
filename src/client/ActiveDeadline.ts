// Slice 3.6b: a deadline that only counts time the page was able to run.
//
// AbortSignal.timeout(ms) is wall-clock. When the main thread is starved (a
// software-WebGL VM loading the game chunk blocks it for 17-22 s), a response
// that arrived within a second is not delivered until the thread frees up, and
// by then the timer is overdue and aborts it: a good /auth/refresh or
// /users/@me 200 is thrown away and the player is shown signed out. A real
// stall (no response while the page is idle) still times out.
//
// Each tick adds at most 2 * TICK_MS to the budget, so a blocked thread only
// ever "spends" two ticks, however long it was blocked.
const TICK_MS = 500;

export function activeDeadlineSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  let spent = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    spent += Math.min(now - last, TICK_MS * 2);
    last = now;
    if (spent >= ms) {
      clearInterval(timer);
      controller.abort(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
    }
  }, TICK_MS);
  // The interval also ends by itself after at most `ms` of active time, even
  // when the request settled first, so nothing is left to clean up.
  controller.signal.addEventListener("abort", () => clearInterval(timer));
  return controller.signal;
}
