import { EventBus } from "@openfront/shared/EventBus";
import { ChatEntry } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatState,
  chatVisible,
  ReportChatEvent,
} from "../../src/client/ChatState";
import type { ChatDisplay } from "../../src/client/hud/layers/ChatDisplay";
import "../../src/client/hud/layers/ChatDisplay";
import type { ChatInput } from "../../src/client/hud/layers/ChatInput";
import "../../src/client/hud/layers/ChatInput";

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));
vi.mock("../../src/client/InGameModal", () => ({
  showInGameConfirm: vi.fn(async () => true),
}));

const entry = (over: Partial<ChatEntry> = {}): ChatEntry => ({
  id: 1,
  fromClientID: "bobbbbbb" as any,
  channel: "alliance",
  text: "hi",
  root: false,
  system: false,
  turn: 1,
  ...over,
});
const view = (o: { friendly?: boolean; name?: string; cid?: string } = {}) =>
  ({
    isFriendly: () => o.friendly ?? false,
    displayName: () => o.name ?? "bob",
    clientID: () => o.cid ?? "bobbbbbb",
  }) as any;
const ctx = (over: Record<string, unknown> = {}) => ({
  // isFriendly is asked of the local player's view.
  me: view({ cid: "meeeeeee", name: "me", friendly: true }),
  sender: view(),
  isRoot: false,
  ...over,
});

describe("chatVisible (alliance filter)", () => {
  it("global is always visible", () => {
    expect(
      chatVisible(entry({ channel: "global" }), ctx({ sender: view() })),
    ).toBe(true);
  });
  it("alliance shows for self, ally or teammate", () => {
    expect(chatVisible(entry({ fromClientID: "meeeeeee" as any }), ctx())).toBe(
      true,
    );
    expect(chatVisible(entry(), ctx())).toBe(true);
  });
  it("alliance hides for a non-ally", () => {
    expect(chatVisible(entry(), ctx({ me: view({ cid: "meeeeeee" }) }))).toBe(
      false,
    );
    expect(chatVisible(entry(), ctx({ sender: null }))).toBe(false);
  });
  it("root sees every alliance message", () => {
    expect(
      chatVisible(
        entry(),
        ctx({ isRoot: true, me: null, sender: view({ friendly: false }) }),
      ),
    ).toBe(true);
  });
});

describe("client mute", () => {
  beforeEach(() => {
    localStorage.clear();
    chatState.unmuteAll();
  });
  it("hides a muted sender and persists by name", () => {
    chatState.mute("bob");
    expect(
      chatVisible(entry({ channel: "global" }), ctx({ sender: view() })),
    ).toBe(false);
    expect(JSON.parse(localStorage.getItem("ht.chat.muted")!)).toEqual(["bob"]);
    chatState.unmuteAll();
    expect(
      chatVisible(entry({ channel: "global" }), ctx({ sender: view() })),
    ).toBe(true);
  });
});

describe("ChatDisplay report and mute actions", () => {
  let el: ChatDisplay;
  let events: ReportChatEvent[];
  beforeEach(() => {
    localStorage.clear();
    chatState.reset();
    chatState.unmuteAll();
    chatState.isRoot = false;
    events = [];
    el = document.createElement("chat-display") as ChatDisplay;
    const bus = new EventBus();
    bus.on(ReportChatEvent, (e) => events.push(e));
    el.eventBus = bus;
    el.game = {
      ticks: () => 1,
      myPlayer: () => view({ cid: "meeeeeee", name: "me" }),
      playerByClientID: (id: string) =>
        id === "bobbbbbb" ? view() : view({ cid: "meeeeeee", name: "me" }),
      updatesSinceLastTick: () => null,
    } as any;
    document.body.appendChild(el);
    el.init();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const msg = (id: number, from: string, over: Record<string, unknown> = {}) =>
    chatState.handle({
      type: "chat",
      id,
      fromClientID: from as any,
      channel: "global",
      text: "yo",
      root: false,
      system: false,
      turn: 1,
      ...over,
    } as any);

  it("report on another player's line sends chat_report with the id", async () => {
    msg(42, "bobbbbbb");
    await el.updateComplete;
    el.querySelector<HTMLElement>('[data-chat-action="report"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(events.map((e) => e.messageId)).toEqual([42]);
  });

  it("own and system lines have no actions", async () => {
    msg(1, "meeeeeee");
    msg(2, "bobbbbbb", { system: true });
    await el.updateComplete;
    expect(el.querySelector("[data-chat-action]")).toBeNull();
  });

  it("muting hides the sender's lines", async () => {
    msg(3, "bobbbbbb");
    await el.updateComplete;
    el.querySelector<HTMLElement>('[data-chat-action="mute"]')!.click();
    await el.updateComplete;
    expect(el.textContent).not.toContain("yo");
  });

  it("hides alliance lines from non-allies and history replays too", async () => {
    chatState.handle({
      type: "chat_history",
      messages: [entry({ id: 5, text: "secret" })],
    } as any);
    await el.updateComplete;
    expect(el.textContent ?? "").not.toContain("secret");
  });
});

describe("ChatInput commands", () => {
  const send = async (text: string, isRoot: boolean) => {
    const el = document.createElement("chat-input") as ChatInput;
    const sent: string[] = [];
    const bus = new EventBus();
    bus.on((await import("../../src/client/ChatState")).SendChatEvent, (e) =>
      sent.push(e.text),
    );
    el.eventBus = bus;
    el.game = {
      isSpectator: () => false,
      config: () => ({ gameConfig: () => ({ gameType: "Public" }) }),
    } as any;
    el.uiState = { ghostStructure: null } as any;
    document.body.appendChild(el);
    el.isRoot = isRoot;
    el.openInput();
    await el.updateComplete;
    const input = el.querySelector("input")!;
    input.value = text;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    document.body.innerHTML = "";
    return sent;
  };
  it("rejects /x for non-root, passes it for root, keeps /a and /g", async () => {
    expect(await send("/mute bob", false)).toEqual([]);
    expect(await send("/mute bob", true)).toEqual(["/mute bob"]);
    expect(await send("/a hi", false)).toEqual(["hi"]);
  });
});
