import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTempHome, seedFixtureHome } from "./helpers.js";

const CLI = path.join(import.meta.dir, "..", "dist", "cli", "index.js");

function aem(
  home: string,
  args: string[],
  opts: { expectFail?: boolean } = {},
): string {
  try {
    return execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        AEM_HOME: home,
        AEM_NO_EXEC: "1",
        NO_COLOR: "1",
      },
      cwd: path.join(home, "project"),
    });
  } catch (err: any) {
    if (opts.expectFail) {
      return String(err.stdout ?? "") + String(err.stderr ?? "");
    }
    throw new Error(
      `aem ${args.join(" ")} failed: ${err.stderr ?? err.message}`,
    );
  }
}

beforeAll(() => {
  execFileSync("npm", ["run", "build"], {
    cwd: path.join(import.meta.dir, ".."),
    encoding: "utf8",
  });
});

describe("CLI round-trip in a temp HOME", () => {
  test("scan -> export -> import -> diff -> dry-run -> apply -> drift", () => {
    const home = makeTempHome();
    seedFixtureHome(home);

    // scan
    const scanOut = aem(home, ["scan"]);
    expect(scanOut).toContain("codex");
    expect(scanOut).toContain("claude-code");
    expect(scanOut).toContain("github");
    expect(scanOut).not.toContain("sk-P2vyt");

    const scanJson = JSON.parse(aem(home, ["scan", "--json"]));
    expect(scanJson.kind).toBe("EnvironmentSnapshot");
    expect(scanJson.schemaVersion).toBe("aem.dev/v0");

    // doctor (exit code 2 expected: broken_path/secret findings exist)
    const doctorOut = aem(home, ["doctor"], { expectFail: true });
    expect(doctorOut).toContain("secret_inline");
    expect(doctorOut).not.toContain("sk-P2vyt");

    // export (secret must be redacted in the profile)
    aem(home, ["export", "--profile", "roundtrip"]);
    const profileFile = path.join(home, ".aem", "profiles", "roundtrip.yaml");
    const profileText = fs.readFileSync(profileFile, "utf8");
    expect(profileText).not.toContain("sk-P2vyt");
    expect(profileText).toContain("schemaVersion: aem.dev/v0");
    // machine-specific absolute paths are variable-ized, including paths
    // embedded inside larger values (SERVICES_JSON in the codex fixture)
    expect(profileText).toContain('\"browser\":\"~/.codex/plugins/browser.mjs\"');
    expect(profileText).not.toContain(home);

    // import round-trip under a new name
    aem(home, ["import", profileFile, "--name", "copy"]);
    expect(fs.existsSync(path.join(home, ".aem", "profiles", "copy.yaml"))).toBe(
      true,
    );
    // name conflict without --force fails
    const conflictOut = aem(home, ["import", profileFile, "--name", "copy"], {
      expectFail: true,
    });
    expect(conflictOut).toContain("already exists");

    // profile list/use
    const listOut = aem(home, ["profile", "list"]);
    expect(listOut).toContain("roundtrip");
    expect(listOut).toContain("copy");
    aem(home, ["profile", "use", "roundtrip"]);

    // diff: same machine right after export -> no changes
    const diffOut = aem(home, ["diff"]);
    expect(diffOut).toContain("No changes needed");

    // mutate the profile: add a server -> diff/dry-run must show add
    const yaml = profileText.replace(
      "mcpServers:",
      `mcpServers:
  - id: added-by-test
    enabled: true
    allowedRuntimes:
      - codex
    transport: stdio
    command:
      executable: npx
      args:
        - -y
        - added-server
    env:
      SVC_PATHS:
        source: inline
        required: false
        value: '{"svc":"~/svc-tool/main.mjs"}'`,
    );
    fs.writeFileSync(profileFile, yaml);

    const diff2 = aem(home, ["diff", "--json"]);
    const plan = JSON.parse(diff2);
    const add = plan.changes.find((c: any) => c.resourceRef === "mcp.added-by-test");
    expect(add.action).toBe("add");

    // dry-run must not modify vendor config
    const codexConfig = path.join(home, ".codex", "config.toml");
    const before = fs.readFileSync(codexConfig, "utf8");
    const dryOut = aem(home, ["apply", "--dry-run"]);
    expect(dryOut).toContain("added-by-test");
    expect(fs.readFileSync(codexConfig, "utf8")).toBe(before);

    // real apply (non-interactive) creates backup and modifies config
    const applyOut = aem(home, ["apply", "--yes"]);
    expect(applyOut).toContain("applied");
    const after = fs.readFileSync(codexConfig, "utf8");
    expect(after).toContain("added-by-test");
    expect(after).toContain("keep-me"); // unknown fields preserved through apply
    // portable ~ paths in profile values are materialized on apply
    expect(after).toContain(`${home}/svc-tool/main.mjs`);

    const backups = fs.readdirSync(path.join(home, ".aem", "backups"));
    expect(backups.length).toBe(1);
    const backedUp = fs.readFileSync(
      path.join(home, ".aem", "backups", backups[0]!, "codex", ".codex", "config.toml"),
      "utf8",
    );
    expect(backedUp).toBe(before);

    // audit log recorded the apply
    const audit = fs.readFileSync(
      path.join(home, ".aem", "audit", "events.jsonl"),
      "utf8",
    );
    expect(audit).toContain("apply --profile roundtrip");
    expect(audit).not.toContain("sk-P2vyt");

    // post-apply: diff converges to no changes, scan sees the new server
    const diff3 = aem(home, ["diff"]);
    expect(diff3).toContain("No changes needed");

    // drift: remove a skill dir -> drift detects it
    fs.rmSync(path.join(home, ".codex", "skills", "ralph"), { recursive: true });
    const driftOut = aem(home, ["drift"], { expectFail: true });
    expect(driftOut).toContain("skill.ralph");

    // drift --json shape
    const driftJson = JSON.parse(
      aem(home, ["drift", "--json"], { expectFail: true }),
    );
    expect(driftJson.kind).toBe("DriftReport");
    expect(driftJson.items.some((i: any) => i.resourceRef === "skill.ralph")).toBe(
      true,
    );
  }, 60000);

  test("import rejects a profile containing an inline secret", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const bad = path.join(home, "bad-profile.yaml");
    fs.writeFileSync(
      bad,
      `schemaVersion: aem.dev/v0
kind: DesiredState
metadata:
  name: bad
  createdAt: "2026-09-01T00:00:00Z"
targets:
  runtimes: []
mcpServers:
  - id: leaky
    enabled: true
    allowedRuntimes: [codex]
    transport: stdio
    env:
      KEY:
        source: inline
        required: true
        value: sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1
instructions: []
skills: []
policies:
  secretHandling: forbid-inline
  unknownFields: preserve
`,
    );
    const out = aem(home, ["import", bad], { expectFail: true });
    expect(out).toContain("secret");
    expect(fs.existsSync(path.join(home, ".aem", "profiles", "bad.yaml"))).toBe(
      false,
    );
  });

  test("import rejects unsupported schema version", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, "project"), { recursive: true });
    const bad = path.join(home, "old.yaml");
    fs.writeFileSync(
      bad,
      "schemaVersion: aem.dev/v999\nkind: DesiredState\nmetadata:\n  name: old\nmcpServers: []\n",
    );
    const out = aem(home, ["import", bad], { expectFail: true });
    expect(out).toContain("schemaVersion");
  });
});
