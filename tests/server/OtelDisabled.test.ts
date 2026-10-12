import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerEnv } from "../../src/server/ServerEnv";

// Hostile Takeover (Slice 3.4): Logger.ts and WorkerMetrics.ts only build an
// OTLP exporter behind ServerEnv.otelEnabled(), so it must be false whenever
// the OTEL_* variables are empty or missing, in any game env.
describe("server OTEL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["dev", "prod"])("is off with empty OTEL_* in %s", (gameEnv) => {
    vi.stubEnv("GAME_ENV", gameEnv);
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    vi.stubEnv("OTEL_AUTH_HEADER", "");
    expect(ServerEnv.otelEnabled()).toBe(false);
  });

  it("is off when only the endpoint is set", () => {
    vi.stubEnv("GAME_ENV", "prod");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otel.example");
    vi.stubEnv("OTEL_AUTH_HEADER", "");
    expect(ServerEnv.otelEnabled()).toBe(false);
  });
});
