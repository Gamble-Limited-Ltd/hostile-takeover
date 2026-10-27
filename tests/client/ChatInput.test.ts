import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatState, SendChatEvent } from "../../src/client/ChatState";
import {
  ChatInput,
  parseChatInput,
} from "../../src/client/hud/layers/ChatInput";

const flags = vi.hoisted(() => ({ chat: true }));
vi.mock("../../src/client/Features", () => ({
  Features: {
    get chat() {
      return flags.chat;
    },
  },
}));
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

function setup(opts: { spectator?: boolean; ghost?: string | null } = {}) {
  const el = document.createElement("chat-input") as ChatInput;
  const sent: SendChatEvent[] = [];
  const eventBus = new EventBus();
  eventBus.on(SendChatEvent, (e) => sent.push(e));
  el.eventBus = eventBus;
  el.game = {
    isSpectator: () => opts.spectator ?? false,
    config: () => ({
      gameConfig: () => ({ gameType: GameType.Public }),
    }),
  } as any;
  el.uiState = { ghostStructure: opts.ghost ?? null } as any;
  document.body.appendChild(el);
  el.init();
  return { el, sent };
}

const press = (code: string, target: EventTarget = document.body, key = code) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      code,
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
const input = (el: ChatInput) => el.querySelector("input");

describe("ChatInput", () => {
  beforeEach(() => {
    flags.chat = true;
    chatState.reset();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("parses /a and /g prefixes", () => {
    expect(parseChatInput("/a hi", "global")).toEqual({
      channel: "alliance",
      text: "hi",
    });
    expect(parseChatInput("/g  yo ", "alliance")).toEqual({
      channel: "global",
      text: "yo",
    });
    expect(parseChatInput("/about", "global")).toEqual({
      channel: "global",
      text: "/about",
    });
  });

  it("Enter opens, Enter sends, Escape closes", async () => {
    const { el, sent } = setup();
    press("Enter");
    await el.updateComplete;
    expect(input(el)).not.toBeNull();

    input(el)!.value = "hello";
    press("Enter", input(el)!, "Enter");
    await el.updateComplete;
    expect(sent).toEqual([
      expect.objectContaining({ channel: "global", text: "hello" }),
    ]);
    expect(input(el)).toBeNull();

    press("Enter");
    await el.updateComplete;
    press("Escape", input(el)!, "Escape");
    await el.updateComplete;
    expect(input(el)).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("Tab switches the channel and /a overrides it for one message", async () => {
    const { el, sent } = setup();
    press("Enter");
    await el.updateComplete;
    press("Tab", input(el)!, "Tab");
    await el.updateComplete;
    expect(chatState.channel).toBe("alliance");
    input(el)!.value = "team";
    press("Enter", input(el)!, "Enter");
    press("Enter");
    await el.updateComplete;
    input(el)!.value = "/g everyone";
    press("Enter", input(el)!, "Enter");
    expect(sent.map((s) => [s.channel, s.text])).toEqual([
      ["alliance", "team"],
      ["global", "everyone"],
    ]);
  });

  it("keeps game hotkeys away while typing", async () => {
    const { el } = setup();
    press("Enter");
    await el.updateComplete;
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    press("KeyB", input(el)!, "b");
    window.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("leaves Enter to the ghost structure confirm", async () => {
    const { el } = setup({ ghost: "City" });
    press("Enter");
    await el.updateComplete;
    expect(input(el)).toBeNull();
  });

  it("is read-only for dead players and spectators, but root can type", async () => {
    const { el } = setup({ spectator: true });
    press("Enter");
    await el.updateComplete;
    expect(input(el)).toBeNull();
    el.isRoot = true;
    press("Enter");
    await el.updateComplete;
    expect(input(el)).not.toBeNull();
  });

  it("never opens when Features.chat is false", async () => {
    flags.chat = false;
    const { el } = setup();
    press("Enter");
    await el.updateComplete;
    expect(input(el)).toBeNull();
  });
});
