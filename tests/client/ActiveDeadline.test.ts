import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeDeadlineSignal } from "../../src/client/ActiveDeadline";

// Slice 3.6b: a starved main thread must not turn a delivered 200 into a
// timeout. The clock is driven by hand so one tick can report a 20 s jump, as
// a blocked thread does when it finally runs the overdue timer.
describe("activeDeadlineSignal", () => {
  let now = 0;
  const tick = (wallMs: number) => {
    now += wallMs;
    vi.advanceTimersByTime(500);
  };

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts with a TimeoutError after the deadline of active time", () => {
    const signal = activeDeadlineSignal(10_000);
    for (let i = 0; i < 19; i++) tick(500);
    expect(signal.aborted).toBe(false);
    tick(500);
    tick(500);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  it("does not count a blocked main thread against the deadline", () => {
    const signal = activeDeadlineSignal(10_000);
    tick(20_000); // the thread was blocked for 20 s; the response is queued
    expect(signal.aborted).toBe(false);
    for (let i = 0; i < 10; i++) tick(500); // plenty of time to process it
    expect(signal.aborted).toBe(false);
  });
});
