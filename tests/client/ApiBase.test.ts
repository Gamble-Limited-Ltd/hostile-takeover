import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getApiBase } from "../../src/client/ApiBase";
import { ClientEnv } from "../../src/client/ClientEnv";

function bootstrap(extra: Record<string, unknown> = {}) {
  ClientEnv.reset();
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    turnstileSiteKey: "site-key",
    jwtAudience: "hostile-takeover.taps-holdings.org",
    gitCommit: "abc",
    ...extra,
  };
}

describe("getApiBase", () => {
  beforeEach(() => bootstrap());

  afterEach(() => {
    ClientEnv.reset();
    delete (window as any).BOOTSTRAP_CONFIG;
  });

  it("derives api.<audience> when no apiUrl is injected", () => {
    expect(getApiBase()).toBe("https://api.hostile-takeover.taps-holdings.org");
    expect(ClientEnv.jwtIssuer()).toBe(
      "https://api.hostile-takeover.taps-holdings.org",
    );
  });

  it("uses the injected apiUrl", () => {
    bootstrap({ apiUrl: "https://hostile-takeover-api.taps-holdings.org" });
    expect(getApiBase()).toBe("https://hostile-takeover-api.taps-holdings.org");
    expect(ClientEnv.jwtIssuer()).toBe(
      "https://hostile-takeover-api.taps-holdings.org",
    );
  });

  it("apiUrl wins over the localhost branch", () => {
    bootstrap({ jwtAudience: "localhost", apiUrl: "https://api.example.org" });
    expect(getApiBase()).toBe("https://api.example.org");
  });

  it("keeps the localhost fallback when no apiUrl is injected", () => {
    bootstrap({ jwtAudience: "localhost" });
    expect(getApiBase()).toBe("http://localhost:8787");
  });
});
