import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Hermetic tests for preship.sh, scripts/preship-lib.sh and scripts/preship-inner.sh.
// Every test builds a throwaway git repo and stubs buildpc-run / npm / npx via PATH,
// so nothing here touches the network, the offload PC or this repo's tree.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LIB = path.join(ROOT, "scripts/preship-lib.sh");
const INNER = path.join(ROOT, "scripts/preship-inner.sh");
const PRESHIP = path.join(ROOT, "preship.sh");

let tmp: string;
let repo: string;
let stubs: string;
let log: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function write(rel: string, content = "x\n"): void {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function stub(name: string, body: string): void {
  const p = path.join(stubs, name);
  fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

const SYSTEM_PATH = "/usr/bin:/bin";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${stubs}:${SYSTEM_PATH}`,
    HOME: tmp, // no nvm dir, so preship.sh leaves PATH alone
    STUB_LOG: log,
    LIB,
    ...extra,
  };
}

// Run a lib function (or snippet) inside the fixture repo.
function lib(
  snippet: string,
  extra: Record<string, string> = {},
): { code: number; out: string; err: string } {
  const r = spawnSync(
    "bash",
    ["-c", `set -euo pipefail; source "$LIB"; ${snippet}`],
    { cwd: repo, env: env(extra), encoding: "utf8" },
  );
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}

function lines(s: string): string[] {
  return s.split("\n").filter(Boolean);
}

function calls(): string[] {
  return fs.existsSync(log) ? lines(fs.readFileSync(log, "utf8")) : [];
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preship-"));
  repo = path.join(tmp, "repo");
  stubs = path.join(tmp, "stubs");
  log = path.join(tmp, "calls.log");
  fs.mkdirSync(repo);
  fs.mkdirSync(stubs);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write(".gitignore", "ignored/\nnode_modules/\n");
  write("src/a.ts");
  write("src/b.ts");
  write("README.md");
  write("package.json", "{}\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("switch", "-q", "-c", "work");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ps_changed_files", () => {
  it("is empty on a clean branch", () => {
    expect(lib("ps_changed_files").out).toBe("");
  });

  it("covers branch commits, staged, unstaged and untracked, sorted and unique", () => {
    write("src/c.ts");
    git("add", "src/c.ts");
    git("commit", "-qm", "c");
    write("src/b.ts", "changed\n");
    write("README.md", "staged\n");
    git("add", "README.md");
    write("README.md", "staged and edited\n");
    write("src/new.ts");
    expect(lines(lib("ps_changed_files").out)).toEqual([
      "README.md",
      "src/b.ts",
      "src/c.ts",
      "src/new.ts",
    ]);
  });

  it("leaves out ignored files, .nodeterm/ and deleted files, and keeps only the new name of a rename", () => {
    write("ignored/x.ts");
    write(".nodeterm/state.json");
    git("rm", "-q", "src/a.ts");
    git("mv", "src/b.ts", "src/renamed.ts");
    expect(lines(lib("ps_changed_files").out)).toEqual(["src/renamed.ts"]);
  });

  it("uses HEAD as the base when there is no origin/main or main", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    git("branch", "-m", "work", "feature");
    git("branch", "-D", "main");
    write("src/new.ts");
    expect(lines(lib("ps_changed_files").out)).toEqual(["src/new.ts"]);
  });
});

describe("ps_filter_kind", () => {
  const input = [
    "src/a.ts",
    "src/b.tsx",
    "scripts/x.mjs",
    "README.md",
    "package.json",
    "resources/lang/en.json",
    "resources/img.png",
    "styles.css",
    "preship.sh",
  ].join("\n");

  it("lint keeps JS and TS sources only", () => {
    expect(lines(lib(`ps_filter_kind lint <<< '${input}'`).out)).toEqual([
      "src/a.ts",
      "src/b.tsx",
      "scripts/x.mjs",
    ]);
  });

  it("prettier passes everything through (it skips what it does not know)", () => {
    expect(lines(lib(`ps_filter_kind prettier <<< '${input}'`).out)).toEqual(
      input.split("\n"),
    );
  });

  it("test keeps code and json under src, packages, tests and resources", () => {
    const files = [
      "src/a.ts",
      "tests/x.test.ts",
      "packages/engine/src/y.ts",
      "resources/lang/en.json",
      "README.md",
      "scripts/x.mjs",
      "src/style.css",
    ].join("\n");
    expect(lines(lib(`ps_filter_kind test <<< '${files}'`).out)).toEqual([
      "src/a.ts",
      "tests/x.test.ts",
      "packages/engine/src/y.ts",
      "resources/lang/en.json",
    ]);
  });

  it("rejects an unknown kind", () => {
    expect(lib("ps_filter_kind nope </dev/null").code).not.toBe(0);
  });
});

describe("ps_parse_args", () => {
  function parse(...args: string[]) {
    const q = args.map((a) => `'${a}'`).join(" ");
    return lib(`ps_parse_args ${q}; echo "$PS_MODE $PS_LOCAL"`);
  }
  it("defaults to quick, offload allowed", () => {
    expect(parse().out.trim()).toBe("quick 0");
  });
  it("parses --full, --status, --help and --local", () => {
    expect(parse("--full").out.trim()).toBe("full 0");
    expect(parse("--status").out.trim()).toBe("status 0");
    expect(parse("--help").out.trim()).toBe("help 0");
    expect(parse("--local").out.trim()).toBe("quick 1");
    expect(parse("--full", "--local").out.trim()).toBe("full 1");
  });
  it("exits 2 on unknown flags and conflicting modes", () => {
    const bad = parse("--nope");
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--nope");
    expect(parse("--full", "--status").code).toBe(2);
  });
});

describe("ps_tree_fingerprint", () => {
  const fp = () => lib("ps_tree_fingerprint").out.trim();

  it("is stable and a sha256 hex string", () => {
    write("src/new.ts");
    const a = fp();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fp()).toBe(a);
  });

  it("changes with tracked edits, untracked files and new commits, but not with ignored files or .nodeterm", () => {
    const clean = fp();
    write("ignored/x.ts");
    write(".nodeterm/s.json");
    expect(fp()).toBe(clean);

    write("src/a.ts", "edit\n");
    const edited = fp();
    expect(edited).not.toBe(clean);

    write("src/untracked.ts", "one\n");
    const withUntracked = fp();
    expect(withUntracked).not.toBe(edited);

    write("src/untracked.ts", "two\n");
    expect(fp()).not.toBe(withUntracked);

    const before = fp();
    git("add", "-A");
    git("commit", "-qm", "commit");
    expect(fp()).not.toBe(before); // HEAD sha is part of it
  });

  it("is the same for the same content however it got there", () => {
    write("src/a.ts", "same\n");
    const unstaged = fp();
    git("add", "src/a.ts");
    expect(fp()).toBe(unstaged);
  });
});

describe("result record and --status", () => {
  const status = () => lib("ps_status");

  it("says there is no pass when nothing was recorded", () => {
    const r = status();
    expect(r.code).toBe(1);
    expect(r.out).toContain("no full pass");
  });

  it("reports a full pass for the current tree with exit 0", () => {
    lib("ps_write_record full pass 190");
    const r = status();
    expect(r.code).toBe(0);
    expect(r.out).toContain("FULL pass");
    expect(r.out).toContain("190s");
    expect(fs.existsSync(path.join(repo, ".git/ht-preship-last"))).toBe(true);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("does not count a quick pass as a full pass", () => {
    lib("ps_write_record quick pass 30");
    const r = status();
    expect(r.code).toBe(1);
    expect(r.out).toContain("quick pass");
    expect(r.out).toContain("no full pass");
  });

  it("keeps the full record when a quick run follows on the same tree", () => {
    lib("ps_write_record full pass 190");
    lib("ps_write_record quick pass 30");
    expect(status().code).toBe(0);
  });

  it("does not count a failed full run", () => {
    lib("ps_write_record full fail 100");
    const r = status();
    expect(r.code).toBe(1);
    expect(r.out).toContain("FAILED");
  });

  it("goes stale as soon as the tree changes", () => {
    lib("ps_write_record full pass 190");
    write("src/a.ts", "later edit\n");
    const r = status();
    expect(r.code).toBe(1);
    expect(r.out).toContain("changed since");
  });
});

describe("ps_only_inventory_failures", () => {
  const check = (content: string) => {
    const f = path.join(tmp, "v.log");
    fs.writeFileSync(f, content);
    return lib(`ps_only_inventory_failures '${f}'`).code;
  };
  const inv =
    " FAIL  tests/client/InventoryModal.test.ts > InventoryModal > renders [5000ms]\n";
  const other = " FAIL  tests/Attack.test.ts > Attack > wins\n";

  it("is true when every failure is an InventoryModal one (ANSI colours ignored)", () => {
    expect(check(inv + inv)).toBe(0);
    expect(
      check(
        `\u001b[31m FAIL \u001b[39m  tests/client/InventoryModal.test.ts > x\n`,
      ),
    ).toBe(0);
  });
  it("is false when any other test failed, when nothing failed, or on unhandled errors", () => {
    expect(check(inv + other)).toBe(1);
    expect(check(other)).toBe(1);
    expect(check("Tests 5 passed\n")).toBe(1);
    expect(check(inv + "Unhandled Errors\n")).toBe(1);
  });
});

describe("preship.sh wrapper", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(repo, "scripts"));
    fs.copyFileSync(PRESHIP, path.join(repo, "preship.sh"));
    fs.copyFileSync(LIB, path.join(repo, "scripts/preship-lib.sh"));
    fs.writeFileSync(
      path.join(repo, "scripts/preship-inner.sh"),
      `#!/usr/bin/env bash\necho "inner $*" >> "$STUB_LOG"\necho "build=\${PRESHIP_BUILD:-unset}" >> "$STUB_LOG"\nexit "\${STUB_INNER_EXIT:-0}"\n`,
    );
    git("add", "-A");
    git("commit", "-qm", "scripts");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    // buildpc-run stub: log flags, then run the command after "--" (like a local run).
    stub(
      "buildpc-run",
      `echo "buildpc-run $*" >> "$STUB_LOG"
[ -n "\${STUB_RB_EXIT:-}" ] && { echo "buildpc: not offloaded (stub)" >&2; exit "$STUB_RB_EXIT"; }
while [ "$1" != "--" ]; do shift; done; shift
exec "$@"`,
    );
  });

  const run = (
    args: string[],
    extra: Record<string, string> = {},
    path_?: string,
  ) =>
    spawnSync("bash", [path.join(repo, "preship.sh"), ...args], {
      cwd: repo,
      env: { ...env(extra), ...(path_ ? { PATH: path_ } : {}) },
      encoding: "utf8",
    });

  it("--help prints usage and exits 0 without running anything", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--full");
    expect(calls()).toEqual([]);
  });

  it("an unknown flag exits 2", () => {
    expect(run(["--bogus"]).status).toBe(2);
  });

  it("quick offloads light with a local fallback and passes the changed files", () => {
    write("src/new.ts");
    const r = run([]);
    expect(r.status).toBe(0);
    const c = calls();
    expect(c[0]).toContain("buildpc-run --light --fallback local --");
    expect(c[0]).toContain("scripts/preship-inner.sh quick -- src/new.ts");
    expect(c).not.toContain("build=1");
  });

  it("full offloads heavy with no fallback and enables the build", () => {
    const r = run(["--full"]);
    expect(r.status).toBe(0);
    const c = calls();
    expect(c[0]).toContain(
      "buildpc-run --heavy --fallback none --env PRESHIP_BUILD --",
    );
    expect(c[0]).toContain("scripts/preship-inner.sh full");
    expect(c).toContain("build=1");
  });

  it("full exits 75 with the GitHub CI hint when the PC is not available, and records nothing", () => {
    const r = run(["--full"], { STUB_RB_EXIT: "75" });
    expect(r.status).toBe(75);
    expect(r.stderr + r.stdout).toContain("push the branch");
    expect(fs.existsSync(path.join(repo, ".git/ht-preship-last"))).toBe(false);
  });

  it("--local never calls buildpc-run, and --full --local skips the build", () => {
    run(["--local"]);
    run(["--full", "--local"]);
    const c = calls();
    expect(c.some((l) => l.startsWith("buildpc-run"))).toBe(false);
    expect(c.filter((l) => l.startsWith("inner"))).toHaveLength(2);
    expect(c.filter((l) => l === "build=1")).toHaveLength(0);
  });

  it("without buildpc-run installed: quick runs inner directly, full exits 75 with the CI message", () => {
    fs.rmSync(path.join(stubs, "buildpc-run"));
    const q = run([], {}, SYSTEM_PATH);
    expect(q.status).toBe(0);
    expect(calls()[0]).toContain("inner quick");
    const f = run(["--full"], {}, SYSTEM_PATH);
    expect(f.status).toBe(75);
    expect(f.stderr + f.stdout).toContain("push the branch");
  });

  it("propagates a failing inner run and records a fail; a pass records a pass", () => {
    const bad = run(["--full"], { STUB_INNER_EXIT: "1" });
    expect(bad.status).toBe(1);
    expect(run(["--status"]).status).toBe(1);
    const ok = run(["--full"]);
    expect(ok.status).toBe(0);
    const st = run(["--status"]);
    expect(st.status).toBe(0);
    expect(st.stdout).toContain("FULL pass");
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("preship-inner.sh", () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(repo, "node_modules"));
    // npm / npx stubs: log the call; fail when the call matches STUB_FAIL; replay STUB_OUT.
    const body = `echo "$(basename "$0") $*" >> "$STUB_LOG"
[ -n "\${STUB_OUT:-}" ] && cat "$STUB_OUT"
if [ -n "\${STUB_FAIL:-}" ] && [[ "$*" == *"$STUB_FAIL"* ]]; then exit 1; fi
exit 0`;
    stub("npm", body);
    stub("npx", body);
  });

  const inner = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync("bash", [INNER, ...args], {
      cwd: repo,
      env: env(extra),
      encoding: "utf8",
    });

  const has = (needle: string) => calls().some((c) => c.includes(needle));

  it("quick: typecheck always, lint/prettier/vitest only for the changed files", () => {
    const r = inner(["quick", "--", "src/a.ts", "README.md"]);
    expect(r.status).toBe(0);
    expect(has("npm run typecheck")).toBe(true);
    expect(has("npm run lint:oxlint -- src/a.ts")).toBe(true);
    expect(has("npm run lint:eslint -- --no-warn-ignored src/a.ts")).toBe(true);
    expect(has("prettier --check --ignore-unknown src/a.ts README.md")).toBe(
      true,
    );
    expect(has("vitest related --run")).toBe(true);
    expect(has("build-prod")).toBe(false);
    expect(r.stdout).toContain("PASS");
  });

  it("quick: skips steps with no matching changed files and says so", () => {
    const r = inner(["quick", "--", "README.md"]);
    expect(r.status).toBe(0);
    expect(has("lint:oxlint")).toBe(false);
    expect(has("vitest")).toBe(false);
    expect(r.stdout).toContain("skipped: no changed files");
  });

  it("quick with no files at all still typechecks and skips the rest", () => {
    const r = inner(["quick"]);
    expect(r.status).toBe(0);
    expect(calls()).toEqual(["npm run typecheck"]);
  });

  it("quick: runs changed test files through vitest too", () => {
    inner(["quick", "--", "tests/tools/X.test.ts"]);
    expect(has("vitest related --run tests/tools/X.test.ts")).toBe(true);
  });

  it("full: everything CI runs, build only when PRESHIP_BUILD=1", () => {
    const r = inner(["full"]);
    expect(r.status).toBe(0);
    for (const needle of [
      "npm run typecheck",
      "npm run lint:oxlint",
      "npm run lint:eslint",
      "prettier --check .",
      "vitest run --maxWorkers",
      "vitest run tests/server",
    ]) {
      expect(has(needle)).toBe(true);
    }
    expect(has("build-prod")).toBe(false);
    expect(r.stdout).toContain("build-prod: skipped");
    calls();
    fs.rmSync(log);
    inner(["full"], { PRESHIP_BUILD: "1" });
    expect(has("npm run build-prod")).toBe(true);
  });

  it("with PRESHIP_BUILD=1 clears leftover static/ before and after; otherwise leaves it alone", () => {
    fs.mkdirSync(path.join(repo, "static"));
    inner(["full"]);
    expect(fs.existsSync(path.join(repo, "static"))).toBe(true);
    inner(["full"], { PRESHIP_BUILD: "1" });
    expect(fs.existsSync(path.join(repo, "static"))).toBe(false);
  });

  it("leaves tests/UpdateRegister.test.ts out, with a note, only when jq is missing", () => {
    const noJq = inner(["full"], { PRESHIP_ASSUME_NO_JQ: "1" });
    expect(has("--exclude tests/UpdateRegister.test.ts")).toBe(true);
    expect(noJq.stdout).toContain("tests/UpdateRegister.test.ts was NOT run");
    fs.rmSync(log);
    stub("jq", "exit 0");
    const withJq = inner(["full"]);
    expect(has("--exclude")).toBe(false);
    expect(withJq.stdout).not.toContain("NOT run");
  });

  it("exits non-zero when any step fails, and names it in the summary", () => {
    const r = inner(["full"], { STUB_FAIL: "prettier" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/prettier\s+FAIL/);
    expect(r.stdout).toContain("FAILED");
  });

  it("prints the InventoryModal note only when those are the only failures", () => {
    const out = path.join(tmp, "vitest-out.txt");
    fs.writeFileSync(
      out,
      " FAIL  tests/client/InventoryModal.test.ts > a > b\n",
    );
    const only = inner(["full"], {
      STUB_FAIL: "vitest run --max",
      STUB_OUT: out,
    });
    expect(only.status).toBe(1);
    expect(only.stdout).toContain("InventoryModal");
    expect(only.stdout).toContain("known flaky");

    fs.writeFileSync(out, " FAIL  tests/Attack.test.ts > a\n");
    const other = inner(["full"], {
      STUB_FAIL: "vitest run --max",
      STUB_OUT: out,
    });
    expect(other.status).toBe(1);
    expect(other.stdout).not.toContain("known flaky");
  });

  it("rejects an unknown mode with exit 2", () => {
    expect(inner(["bogus"]).status).toBe(2);
  });
});
