import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: async () => "Bearer t",
}));
vi.mock("../../src/client/Api", () => ({ getApiBase: () => "http://api" }));

import { sendFriendRequest } from "../../src/client/FriendsApi";

const reply = (status: number, body: unknown = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("sendFriendRequest", () => {
  it("maps API answers to calm client errors", async () => {
    reply(201, { status: "requested" });
    expect(await sendFriendRequest("Bob")).toEqual({ status: "requested" });
    reply(404);
    expect(await sendFriendRequest("Bob")).toBe("not_found");
    reply(403);
    expect(await sendFriendRequest("Bob")).toBe("link_required");
    reply(503);
    expect(await sendFriendRequest("Bob")).toBe("unavailable");
    reply(429);
    expect(await sendFriendRequest("Bob")).toBe("request_failed");
  });
});
