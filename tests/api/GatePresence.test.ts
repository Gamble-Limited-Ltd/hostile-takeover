import { uuidToBase64url } from "@openfront/shared/Base64";
import { describe, expect, test, vi } from "vitest";
import type { ApiEnv } from "../../packages/api/src/env";
import {
  PresenceTracker,
  presenceEnabled,
  reportPresence,
} from "../../packages/api/src/gatePresence";

const env = {
  gateIssuer: "https://id.example",
  gateClientId: "hostile-takeover",
  gateClientSecret: "s3cret",
  gateDirectUrl: "http://gate:3301",
} as ApiEnv;

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(linked: number, unlinked = 0) {
  const tracker = new PresenceTracker();
  const ids: string[] = [];
  const fake = {
    gateSubsForUserIds: async (u: string[]) =>
      u
        .filter((x) => Number(x.slice(-12)) <= linked)
        .map((x) => `sub-${x.slice(-12)}`),
  };
  for (let i = 1; i <= linked + unlinked; i++)
    ids.push(uuidToBase64url(uuid(i)));
  tracker.record("a", ids);
  return { fake, tracker };
}

const ok = () => new Response('{"accepted":1}', { status: 200 });

describe("gate presence", () => {
  test("batches of 500 to GATE_DIRECT_URL with Basic auth", async () => {
    const { fake, tracker } = setup(1100);
    const f = vi.fn(async (_u: string, _i: RequestInit) => ok());
    await reportPresence(env, fake, tracker, f as never, () => {});
    expect(f).toHaveBeenCalledTimes(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gate:3301/oidc/presence");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Basic " + Buffer.from("hostile-takeover:s3cret").toString("base64"),
    );
    const sizes = f.mock.calls.map(
      (c) => JSON.parse(c[1].body as string).subs.length,
    );
    expect(sizes).toEqual([500, 500, 100]);
  });

  test("players without a GATE link are skipped; nobody linked means no call", async () => {
    const { fake, tracker } = setup(2, 3);
    const f = vi.fn(async (_u: string, _i: RequestInit) => ok());
    await reportPresence(env, fake, tracker, f as never, () => {});
    expect(JSON.parse(f.mock.calls[0][1].body as string).subs).toEqual([
      "sub-000000000001",
      "sub-000000000002",
    ]);
    const none = setup(0, 3);
    const g = vi.fn(async (_u: string, _i: RequestInit) => ok());
    await reportPresence(env, none.fake, none.tracker, g as never, () => {});
    expect(g).not.toHaveBeenCalled();
    const empty = new PresenceTracker();
    await reportPresence(env, fake, empty, g as never, () => {});
    expect(g).not.toHaveBeenCalled();
  });

  test("errors and 401/404/429 are logged once and never thrown", async () => {
    const { fake, tracker } = setup(1);
    const log = vi.fn();
    for (const status of [404, 404, 429]) {
      await reportPresence(
        env,
        fake,
        tracker,
        (async () => new Response("", { status })) as never,
        log,
      );
    }
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "gate presence: HTTP 404",
      "gate presence: HTTP 429",
    ]);
    const boom = (async () => {
      throw new Error("timeout");
    }) as never;
    await expect(
      reportPresence(env, fake, tracker, boom, log),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenLastCalledWith("gate presence: timeout");
  });

  test("kill switch and missing GATE config turn it off", () => {
    expect(presenceEnabled(env, {})).toBe(true);
    expect(presenceEnabled(env, { HT_GATE_PRESENCE: "off" })).toBe(false);
    expect(presenceEnabled({ ...env, gateClientSecret: "" }, {})).toBe(false);
    expect(presenceEnabled({ ...env, gateIssuer: "" }, {})).toBe(false);
  });

  test("a server that stopped checking in drops out", () => {
    const t = new PresenceTracker();
    t.record("a", ["x"], 1000);
    t.record("b", ["x", "y"], 30_000);
    expect(t.online(40_000).sort()).toEqual(["x", "y"]);
    expect(t.online(70_000)).toEqual([]);
  });
});
