import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ServerMessage } from "@openfront/shared/WireSchemas";
import { ChatRelay } from "../../src/server/ChatRelay";
import { Client } from "../../src/server/Client";
import { cid, makeClient } from "../util/GameServerHarness";

let now = 1_000_000;
let sent: Map<string, ServerMessage[]>;
let all: Client[];

function relay() {
  return new ChatRelay({
    recipients: () => all,
    send: (c, m) => sent.get(c.clientID)!.push(m),
    turn: () => 7,
    now: () => now,
    kick: () => {},
    gameId: () => "g",
    endGame: () => {},
    markUnranked: () => {},
  });
}
function join(tag: string, opts: Parameters<typeof makeClient>[0] = {}) {
  const c = makeClient({ clientID: cid(tag), ...opts });
  all.push(c);
  sent.set(c.clientID, []);
  return c;
}
const got = (c: Client) => sent.get(c.clientID)!;
const chats = (c: Client) => got(c).filter((m) => m.type === "chat");

beforeEach(() => {
  now = 1_000_000;
  sent = new Map();
  all = [];
  delete process.env.HT_CHAT;
});
afterEach(() => {
  delete process.env.HT_CHAT;
});

describe("ChatRelay", () => {
  it("delivers global chat to players and spectators, with root set by the server", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    const spec = join("spec", { spectator: true });
    const root = join("root", { role: "root" });
    r.handle(a, { type: "chat", channel: "global", text: " hi there " });
    r.handle(root, { type: "chat", channel: "global", text: "boss" });
    for (const c of [a, b, spec, root]) expect(chats(c)).toHaveLength(2);
    const first = chats(b)[0] as any;
    expect(first).toMatchObject({
      fromClientID: a.clientID,
      channel: "global",
      text: "hi there",
      root: false,
      system: false,
      turn: 7,
    });
    expect((chats(b)[1] as any).root).toBe(true);
    expect((chats(b)[1] as any).id).toBeGreaterThan(first.id);
  });

  it("refuses 201 chars with too_long and empty text silently", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    r.handle(a, { type: "chat", channel: "global", text: "x".repeat(201) });
    expect(got(a)).toEqual([{ type: "chat_error", reason: "too_long" }]);
    r.handle(a, { type: "chat", channel: "global", text: "   " });
    expect(got(a)).toHaveLength(1);
    r.handle(a, { type: "chat", channel: "global", text: "x".repeat(200) });
    expect(chats(b)).toHaveLength(1);
  });

  it("masks profanity with asterisks", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    r.handle(a, { type: "chat", channel: "global", text: "you are a fuck ok" });
    const text = (chats(b)[0] as any).text as string;
    expect(text).not.toContain("fuck");
    expect(text).toContain("****");
    expect(text.length).toBe("you are a fuck ok".length);
  });

  it("drops the 6th message in 10 s, then recovers", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    for (let i = 0; i < 6; i++) {
      r.handle(a, { type: "chat", channel: "global", text: `m${i}` });
    }
    expect(chats(b)).toHaveLength(5);
    expect(got(a)[got(a).length - 1]).toEqual({
      type: "chat_error",
      reason: "rate_limited",
    });
    now += 10_001;
    r.handle(a, { type: "chat", channel: "global", text: "again" });
    expect(chats(b)).toHaveLength(6);
  });

  it("answers a muted sender with chat_error and relays nothing", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    a.chatMute = { until: now + 60_000, shadow: false };
    r.handle(a, { type: "chat", channel: "global", text: "hello" });
    expect(got(a)).toEqual([{ type: "chat_error", reason: "muted" }]);
    expect(chats(b)).toHaveLength(0);
    now += 61_000;
    r.handle(a, { type: "chat", channel: "global", text: "hello" });
    expect(chats(b)).toHaveLength(1);
  });

  it("echoes a shadow-muted message to the sender only and does not buffer it", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    a.chatMute = { until: now + 60_000, shadow: true };
    r.handle(a, { type: "chat", channel: "global", text: "psst" });
    expect(chats(a)).toHaveLength(1);
    expect(chats(b)).toHaveLength(0);
    const late = join("late");
    r.sendHistory(late);
    expect(got(late)).toEqual([]);
  });

  it("caps the ring buffer at 50 and sends history; spectators get no alliance", () => {
    const r = relay();
    const a = join("a");
    const root = join("root", { role: "root" });
    for (let i = 0; i < 60; i++) {
      now += 3_000; // stay under the rate limit
      r.handle(a, {
        type: "chat",
        channel: i % 10 === 0 ? "alliance" : "global",
        text: `m${i}`,
      });
    }
    const player = join("p2");
    r.sendHistory(player);
    const h = got(player)[0] as any;
    expect(h.type).toBe("chat_history");
    expect(h.messages).toHaveLength(50);
    expect(h.messages[0].text).toBe("m10");
    expect(h.messages.at(-1).text).toBe("m59");

    const spec = join("spec", { spectator: true });
    r.sendHistory(spec);
    const sh = (got(spec)[0] as any).messages;
    expect(sh.length).toBeGreaterThan(0);
    expect(sh.every((m: any) => m.channel === "global")).toBe(true);

    r.sendHistory(root);
    expect((got(root)[got(root).length - 1] as any).messages).toHaveLength(50);
  });

  it("sends alliance frames to players and root, never spectators", () => {
    const r = relay();
    const a = join("a");
    const b = join("b");
    const spec = join("spec", { spectator: true });
    const root = join("root", { role: "root", spectator: true });
    r.handle(a, { type: "chat", channel: "alliance", text: "team" });
    expect(chats(b)).toHaveLength(1);
    expect(chats(root)).toHaveLength(1);
    expect(chats(spec)).toHaveLength(0);
  });

  it("HT_CHAT=off disables every chat", () => {
    process.env.HT_CHAT = "off";
    const r = relay();
    const a = join("a");
    const b = join("b");
    r.handle(a, { type: "chat", channel: "global", text: "hi" });
    expect(got(a)).toEqual([{ type: "chat_error", reason: "disabled" }]);
    expect(chats(b)).toHaveLength(0);
  });
});
