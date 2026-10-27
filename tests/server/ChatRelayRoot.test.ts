import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerMessage } from "@openfront/shared/WireSchemas";
import { ChatRelay } from "../../src/server/ChatRelay";
import { Client } from "../../src/server/Client";
import { cid, makeClient } from "../util/GameServerHarness";

const SUB = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
let now = 1_000_000;
let sent: Map<string, ServerMessage[]>;
let all: Client[];
let kicked: string[];
let ended: string[];
let fetchMock: ReturnType<typeof vi.fn>;

function relay() {
  return new ChatRelay({
    recipients: () => all,
    send: (c, m) => sent.get(c.clientID)!.push(m),
    turn: () => 7,
    now: () => now,
    kick: (id) => kicked.push(id),
    gameId: () => "game1",
    endGame: () => ended.push("end"),
    markUnranked: () => ended.push("unranked"),
  });
}
function join(tag: string, opts: Parameters<typeof makeClient>[0] = {}) {
  const c = makeClient({ clientID: cid(tag), username: tag, ...opts });
  all.push(c);
  sent.set(c.clientID, []);
  return c;
}
const withSub = (n: number) => ({ claims: { sub: SUB(n) } as any });
const got = (c: Client) => sent.get(c.clientID)!;
const chats = (c: Client) => got(c).filter((m) => m.type === "chat");
const say = (r: ChatRelay, c: Client, text: string) =>
  r.handle(c, { type: "chat", channel: "global", text });
const posts = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    key: init.headers["x-api-key"],
    body: JSON.parse(init.body),
  }));

beforeEach(() => {
  now = 1_000_000;
  sent = new Map();
  all = [];
  kicked = [];
  ended = [];
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("DOMAIN", "localhost");
  vi.stubEnv("API_KEY", "secret");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ChatRelay root commands", () => {
  it("treats /mute from a non-root as plain text", () => {
    const r = relay();
    const a = join("a");
    const b = join("b", withSub(2));
    say(r, a, "/mute b 5");
    expect((chats(b)[0] as any).text).toBe("/mute b 5");
    expect(b.chatMute).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("root /mute sets an in-memory mute and calls the API with the key", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("Bob", withSub(2));
    say(r, root, "/mute bob 15");
    expect(b.chatMute).toEqual({ until: now + 15 * 60_000, shadow: false });
    expect(chats(b)).toHaveLength(0);
    const [p] = posts();
    expect(p.url).toMatch(/\/game-server\/mute$/);
    expect(p.key).toBeTruthy();
    expect(p.body).toMatchObject({
      actorUsername: "boss",
      minutes: 15,
      shadow: false,
    });
    expect(typeof p.body.targetSub).toBe("string");
    expect(p.body.targetSub).not.toBe(SUB(2));
  });

  it("defaults to 10 minutes; /shadow sets shadow", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob", withSub(2));
    say(r, root, "/shadow bob");
    expect(b.chatMute).toEqual({ until: now + 10 * 60_000, shadow: true });
    expect(posts()[0].body).toMatchObject({ minutes: 10, shadow: true });
  });

  it("/unmute clears the mute and calls the API", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob", withSub(2));
    b.chatMute = { until: now + 99999, shadow: false };
    say(r, root, "/unmute BOB");
    expect(b.chatMute).toBeNull();
    expect(posts()[0].url).toMatch(/\/game-server\/unmute$/);
    expect(posts()[0].body).toMatchObject({ actorUsername: "boss" });
  });

  it("the mute still applies when the API call fails", () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob", withSub(2));
    say(r, root, "/mute bob");
    expect(b.chatMute?.shadow).toBe(false);
  });

  it("/kick uses the kick path and audits", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob", withSub(2));
    say(r, root, "/kick bob");
    expect(kicked).toEqual([b.clientID]);
    expect(posts()[0].url).toMatch(/\/game-server\/audit$/);
    expect(posts()[0].body).toMatchObject({
      actor: "boss",
      action: "kick",
      target: "bob",
    });
  });

  it("/say broadcasts a system message with the root badge, buffered and audited", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob");
    const spec = join("spec", { spectator: true });
    say(r, root, "/say server restarts soon");
    for (const c of [b, spec, root]) {
      expect(chats(c)[0]).toMatchObject({
        text: "server restarts soon",
        system: true,
        root: true,
        channel: "global",
      });
    }
    expect(posts()[0].body).toMatchObject({ actor: "boss", action: "say" });
    const late = join("late");
    r.sendHistory(late);
    expect((got(late)[0] as any).messages).toHaveLength(1);
  });

  it("an unknown name answers root only and nothing is buffered", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob");
    say(r, root, "/mute nobody");
    expect(got(root)).toEqual([
      { type: "chat_error", reason: "no_such_player" },
    ]);
    expect(got(b)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    const late = join("late");
    r.sendHistory(late);
    expect(got(late)).toEqual([]);
  });

  it("commands are never buffered", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    join("bob", withSub(2));
    say(r, root, "/mute bob");
    say(r, root, "/kick bob");
    const late = join("late");
    r.sendHistory(late);
    expect(got(late)).toEqual([]);
  });

  it("an unknown /word from root is ordinary text", () => {
    const r = relay();
    const root = join("boss", { role: "root" });
    const b = join("bob");
    say(r, root, "/hello there");
    expect((chats(b)[0] as any).text).toBe("/hello there");
  });
});

describe("ChatRelay reports", () => {
  it("posts the buffered text with the key, never the client's", () => {
    const r = relay();
    const a = join("a", withSub(1));
    const b = join("b", withSub(2));
    say(r, a, "you are bad");
    const id = (chats(b)[0] as any).id;
    r.report(b, id);
    const [p] = posts();
    expect(p.url).toMatch(/\/game-server\/chat-report$/);
    expect(p.key).toBeTruthy();
    expect(p.body).toMatchObject({ gameId: "game1", message: "you are bad" });
    expect(p.body.reporterSub).not.toBe(p.body.targetSub);
  });

  it("rejects unknown ids, own messages and system messages", () => {
    const r = relay();
    const a = join("a", withSub(1));
    const b = join("b", withSub(2));
    const root = join("boss", { role: "root", ...withSub(3) });
    say(r, a, "hi");
    say(r, root, "/say notice");
    fetchMock.mockClear(); // the /say audit
    const [mine, sys] = chats(b).map((m: any) => m.id);
    r.report(b, 9999);
    r.report(a, mine);
    r.report(b, sys);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows 5 reports a minute per client", () => {
    const r = relay();
    const a = join("a", withSub(1));
    const b = join("b", withSub(2));
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) {
      now += 2_500;
      say(r, a, `m${i}`);
      ids.push((chats(b)[chats(b).length - 1] as any).id);
    }
    for (const id of ids) r.report(b, id);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("ChatRelay alliance frames", () => {
  it("never reach spectators", () => {
    const r = relay();
    const a = join("a");
    const spec = join("spec", { spectator: true });
    r.handle(a, { type: "chat", channel: "alliance", text: "psst" });
    expect(chats(spec)).toHaveLength(0);
  });
});
