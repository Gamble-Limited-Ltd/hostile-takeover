import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearNewTab,
  isNewTab,
  listenSignedIn,
  markNewTab,
  notifySignedIn,
  openInNewTab,
} from "../../src/client/GateTabSignal";

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: unknown) => void) | null = null;
  constructor(readonly name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(m: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && c.name === this.name) c.onmessage?.({ data: m });
    }
  }
  close() {
    FakeChannel.all = FakeChannel.all.filter((c) => c !== this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeChannel.all = [];
  localStorage.clear();
  sessionStorage.clear();
});

describe("tab-to-tab sign-in notice", () => {
  it("BroadcastChannel: the listening tab hears the notice once", () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const cb = vi.fn();
    listenSignedIn(cb);
    notifySignedIn();
    notifySignedIn();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to the storage event without BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const cb = vi.fn();
    const stop = listenSignedIn(cb);
    notifySignedIn(); // sets the key
    const key = localStorage.key(0)!;
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: "1" }));
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores unrelated storage events and stops after unsubscribe", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const cb = vi.fn();
    const stop = listenSignedIn(cb);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "x", newValue: "1" }),
    );
    expect(cb).not.toHaveBeenCalled();
    stop();
    notifySignedIn();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: localStorage.key(0)!,
        newValue: "1",
      }),
    );
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("new-tab marker and opener", () => {
  it("marks, reads and clears", () => {
    expect(isNewTab()).toBe(false);
    markNewTab();
    expect(isNewTab()).toBe(true);
    clearNewTab();
    expect(isNewTab()).toBe(false);
  });

  it("opens a new tab with tab=1, and reports a blocked popup", () => {
    const open = vi.fn(() => ({}));
    vi.stubGlobal("open", open);
    expect(openInNewTab("http://api/auth/gate/start")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "http://api/auth/gate/start?tab=1",
      "_blank",
    );
    vi.stubGlobal(
      "open",
      vi.fn(() => null),
    );
    expect(openInNewTab("http://api/auth/gate/start")).toBe(false);
  });
});
