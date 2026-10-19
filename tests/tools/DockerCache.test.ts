import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Image build speed guards (offload slice 3). The build stage's expensive step
// (tsc + vite via `npm run build-prod`) must only be invalidated by inputs that
// change its output; the commit hash is not one of them, so it must not enter
// that stage's environment. See docs/BuildSpeed.md.

const dockerfile = readFileSync("Dockerfile", "utf8");
const compose = readFileSync("docker-compose.prod.yml", "utf8");

function stage(name: string): string[] {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^FROM .* AS ${name}\\s*$`).test(l),
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("FROM "));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("Dockerfile build cache", () => {
  it("does not put GIT_COMMIT in the build stage before build-prod", () => {
    const build = stage("build");
    const at = build.findIndex((l) => l.includes("npm run build-prod"));
    expect(at).toBeGreaterThan(0);
    const before = build
      .slice(0, at)
      .filter((l) => !l.trimStart().startsWith("#"));
    expect(before.filter((l) => l.includes("GIT_COMMIT"))).toEqual([]);
  });

  it("still stamps the commit in the final image", () => {
    expect(dockerfile).toMatch(
      /ARG GIT_COMMIT=unknown\nRUN echo "\$GIT_COMMIT" > static\/commit\.txt/,
    );
  });
});

describe("prod compose healthchecks", () => {
  it("api and game poll quickly while starting (start_interval)", () => {
    const api = compose.slice(
      compose.indexOf("ht-api:"),
      compose.indexOf("ht-game:"),
    );
    const game = compose.slice(compose.indexOf("ht-game:"));
    expect(api).toMatch(/start_interval:\s*2s/);
    expect(game).toMatch(/start_interval:\s*2s/);
  });
});
