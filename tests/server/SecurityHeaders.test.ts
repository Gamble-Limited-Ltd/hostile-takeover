// @vitest-environment node
import { createHash } from "crypto";
import { describe, expect, test } from "vitest";
import { buildCsp, inlineScriptHashes } from "../../src/server/SecurityHeaders";

const opts = {
  apiOrigin: "https://hostile-takeover-api.taps-holdings.org",
  gameHost: "hostile-takeover.taps-holdings.org",
};

function directive(csp: string, name: string): string[] {
  const d = csp.split("; ").find((x) => x.startsWith(`${name} `));
  return d === undefined ? [] : d.split(" ").slice(1);
}

describe("buildCsp", () => {
  test("forbids framing and plugins", () => {
    const csp = buildCsp(opts);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
  });

  test("script-src is ours plus the Cloudflare beacon, nothing else", () => {
    const src = directive(buildCsp(opts), "script-src");
    expect(src).toEqual(["'self'", "https://static.cloudflareinsights.com"]);
  });

  test("connect-src names the game host (https and wss), the API and Cloudflare", () => {
    expect(directive(buildCsp(opts), "connect-src")).toEqual([
      "'self'",
      "https://hostile-takeover.taps-holdings.org",
      "wss://hostile-takeover.taps-holdings.org",
      "https://hostile-takeover-api.taps-holdings.org",
      "https://static.cloudflareinsights.com",
      "https://cloudflareinsights.com",
    ]);
  });

  test("plain http/ws only when insecure is allowed", () => {
    expect(buildCsp(opts)).not.toContain("ws://");
    const dev = buildCsp({ ...opts, allowInsecure: true });
    expect(dev).toContain("ws://hostile-takeover.taps-holdings.org");
  });

  test("inline script hashes are added to script-src", () => {
    const src = directive(
      buildCsp({ ...opts, inlineScriptHashes: ["sha256-abc="] }),
      "script-src",
    );
    expect(src).toContain("'sha256-abc='");
  });
});

describe("inlineScriptHashes", () => {
  test("hashes inline scripts only, ignoring src and empty ones", () => {
    const body = "\n  window.x = 1;\n";
    const html = `<head><script>${body}</script><script src="/a.js"></script>
      <script type="module" src="/m.js"></script><script data-cfasync="false"> </script></head>`;
    expect(inlineScriptHashes(html)).toEqual([
      `sha256-${createHash("sha256").update(body).digest("base64")}`,
    ]);
  });

  test("a src attribute inside script text does not hide it", () => {
    const html = `<script>const s = 'src=1';</script>`;
    expect(inlineScriptHashes(html)).toHaveLength(1);
  });
});
