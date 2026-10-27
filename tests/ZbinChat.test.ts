import { describe, expect, it } from "vitest";

import {
  ClientMessageSchema,
  ServerMessageSchema,
} from "@openfront/shared/WireSchemas";

const entry = {
  id: 12,
  fromClientID: "abcd1234",
  channel: "alliance" as const,
  text: "hello é world",
  root: true,
  system: false,
  turn: 345,
};

describe("chat wire round-trip", () => {
  it.each([
    { type: "chat", channel: "global", text: "hi" },
    { type: "chat", channel: "alliance", text: "x".repeat(200) },
    { type: "chat_report", messageId: 99 },
  ] as const)("client %j", (msg) => {
    expect(
      ClientMessageSchema.parseBytes(ClientMessageSchema.serialize(msg)),
    ).toEqual(msg);
  });

  it.each([
    { type: "chat", ...entry },
    {
      type: "chat_history",
      messages: [entry, { ...entry, channel: "global" }],
    },
    { type: "chat_history", messages: [] },
    { type: "chat_error", reason: "muted" },
    { type: "chat_error", reason: "rate_limited" },
    { type: "chat_error", reason: "too_long" },
    { type: "chat_error", reason: "disabled" },
  ] as const)("server %j", (msg) => {
    expect(
      ServerMessageSchema.parseBytes(ServerMessageSchema.serialize(msg as any)),
    ).toEqual(msg);
  });

  it("rejects an empty chat", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "chat",
        channel: "global",
        text: "",
      }).success,
    ).toBe(false);
  });
});
