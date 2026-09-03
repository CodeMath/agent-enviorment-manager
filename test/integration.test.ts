import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeTempHome, seedClaudePlugins, seedFixtureHome } from "./helpers.js";

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

  test("project profile: init -> auto-resolution -> scope-aware drift -> apply rejected", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const project = path.join(home, "project");
    // project-scope resources: claude .mcp.json + codex AGENTS.md
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: { "proj-srv": { command: "node", args: [`${project}/tools/srv.js`] } },
      }),
    );
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# project agents\n");

    // init creates a committable project baseline
    const initOut = aem(home, ["init"]);
    expect(initOut).toContain("desired-state.yaml");
    const baselineFile = path.join(project, ".aem", "desired-state.yaml");
    const baseline = fs.readFileSync(baselineFile, "utf8");
    expect(baseline).toContain("scope: project");
    expect(baseline).toContain("proj-srv");
    expect(baseline).toContain("./AGENTS.md"); // project-relative instruction path
    expect(baseline).toContain("${PROJECT_ROOT}/tools/srv.js"); // variable-ized arg
    expect(baseline).not.toContain(home); // no machine-specific paths
    // user-level servers (github, leaky, playwright...) stay out of the repo baseline
    expect(baseline).not.toContain("github");
    expect(baseline).not.toContain("playwright");

    // drift auto-picks the project profile without --profile and is clean
    const driftOut = aem(home, ["drift"]);
    expect(driftOut).toContain("project");
    expect(driftOut).toContain("No drift");

    // user-level MCP changes do NOT drift a project-scoped baseline
    const claudeState = JSON.parse(
      fs.readFileSync(path.join(home, ".claude.json"), "utf8"),
    );
    claudeState.mcpServers["user-only-new"] = { command: "npx", args: ["-y", "x"] };
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify(claudeState, null, 2),
    );
    expect(aem(home, ["drift"])).toContain("No drift");

    // project-scope change DOES drift
    const mcp = JSON.parse(fs.readFileSync(path.join(project, ".mcp.json"), "utf8"));
    mcp.mcpServers["proj-extra"] = { command: "node", args: ["x.js"] };
    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify(mcp));
    const drift2 = aem(home, ["drift"], { expectFail: true });
    expect(drift2).toContain("proj-extra");

    // doctor auto-checks the project baseline
    const doctorOut = aem(home, ["doctor"], { expectFail: true });
    expect(doctorOut).toContain("drift_detected");

    // apply/diff refuse project-scoped profiles (check-only in MVP)
    const applyOut = aem(home, ["apply", "--yes"], { expectFail: true });
    expect(applyOut).toContain("check-only");
    const diffOut = aem(home, ["diff"], { expectFail: true });
    expect(diffOut).toContain("check-only");
  }, 60000);

  test("baseline update accepts drift into the resolved profile with backup + audit", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    seedClaudePlugins(home);

    // user profile exported before a plugin/server showed up locally
    aem(home, ["export", "--profile", "base"]);
    aem(home, ["profile", "use", "base"]);
    const profileFile = path.join(home, ".aem", "profiles", "base.yaml");
    const before = fs.readFileSync(profileFile, "utf8");

    // already in sync -> no-op, exit 0, file untouched
    expect(aem(home, ["baseline", "update", "--yes"])).toContain("already matches");
    expect(fs.readFileSync(profileFile, "utf8")).toBe(before);

    // introduce drift: new user-level MCP server + drop a plugin from the profile
    const claudeState = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
    claudeState.mcpServers["newcomer"] = { command: "npx", args: ["-y", "newcomer"] };
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(claudeState, null, 2));
    fs.writeFileSync(
      profileFile,
      before.replace(/  - id: discord@claude-plugins-official[\s\S]*?applyTo:\n      - claude-code\n/, ""),
    );
    const driftBefore = aem(home, ["drift"], { expectFail: true });
    expect(driftBefore).toContain("mcp.newcomer");
    expect(driftBefore).toContain("plugin.discord@claude-plugins-official");

    // non-interactive without --yes: refuse, nothing written
    const refused = aem(home, ["baseline", "update"], { expectFail: true });
    expect(refused).toContain("--yes");
    expect(aem(home, ["drift"], { expectFail: true })).toContain("mcp.newcomer");

    // accept
    const result = JSON.parse(aem(home, ["baseline", "update", "--yes", "--json"]));
    expect(result.kind).toBe("BaselineUpdate");
    expect(result.profile).toBe("base");
    expect(result.source).toBe("active");
    expect(result.accepted.map((i: any) => i.resourceRef).sort()).toEqual([
      "mcp.newcomer",
      "plugin.discord@claude-plugins-official",
    ]);
    expect(fs.existsSync(path.join(result.backup, ".aem", "profiles", "base.yaml"))).toBe(true);

    const after = fs.readFileSync(profileFile, "utf8");
    expect(after).toContain("id: newcomer");
    expect(after).toContain("id: discord@claude-plugins-official");
    expect(after).toContain("updatedAt:");
    expect(after).not.toContain("sk-P2vyt");
    expect(aem(home, ["drift"])).toContain("No drift");

    const audit = fs.readFileSync(path.join(home, ".aem", "audit", "events.jsonl"), "utf8");
    expect(audit).toContain("baseline update --profile base");
    expect(audit).toContain("mcp.newcomer");
  }, 60000);

  test("baseline update regenerates a project-scope baseline in place", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const project = path.join(home, "project");
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { proj: { command: "node", args: ["s.js"] } } }),
    );
    aem(home, ["init"]);
    const file = path.join(project, ".aem", "desired-state.yaml");

    const mcp = JSON.parse(fs.readFileSync(path.join(project, ".mcp.json"), "utf8"));
    mcp.mcpServers["proj-extra"] = { command: "node", args: ["x.js"] };
    fs.writeFileSync(path.join(project, ".mcp.json"), JSON.stringify(mcp));
    expect(aem(home, ["drift"], { expectFail: true })).toContain("proj-extra");

    const out = aem(home, ["baseline", "update", "--yes"]);
    expect(out).toContain("1 item(s) accepted");
    const yaml = fs.readFileSync(file, "utf8");
    expect(yaml).toContain("scope: project");
    expect(yaml).toContain("id: proj-extra");
    expect(yaml).not.toContain("playwright"); // user-level servers still excluded
    expect(aem(home, ["drift"])).toContain("No drift");
  }, 60000);

  test("init scaffolds .aem/policy.yaml and check flags bypass + PermissionRequest hook", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    seedClaudePlugins(home);
    const project = path.join(home, "project");
    fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { defaultMode: "bypassPermissions" } }),
    );

    // no policy yet -> check fails with guidance
    expect(aem(home, ["check"], { expectFail: true })).toContain("aem init");

    const initOut = aem(home, ["init"]);
    expect(initOut).toContain("Policy ceiling");
    const policyFile = path.join(project, ".aem", "policy.yaml");
    const policy = fs.readFileSync(policyFile, "utf8");
    expect(policy).toContain("kind: Policy");
    expect(policy).toContain("bypassPrompts: false # currently TRUE locally");
    expect(policy).toContain("PermissionRequest: deny");
    expect(policy).toContain("- oh-my-claudecode@omc");
    expect(policy).not.toContain("sk-P2vyt");

    // check: bypass + plugin PermissionRequest hook are violations (exit 5)
    const checkOut = aem(home, ["check"], { expectFail: true });
    expect(checkOut).toContain("ceiling.bypassPrompts");
    expect(checkOut).toContain("hooks.events.PermissionRequest");
    const report = JSON.parse(aem(home, ["check", "--json"], { expectFail: true }));
    expect(report.kind).toBe("CheckReport");
    expect(report.items.filter((i: any) => i.severity === "error").map((i: any) => i.rule).sort()).toEqual([
      "ceiling.bypassPrompts",
      "hooks.events.PermissionRequest",
    ]);

    // doctor picks the project policy up automatically
    const doctorOut = aem(home, ["doctor"], { expectFail: true });
    expect(doctorOut).toContain("policy_violation");
    expect(doctorOut).toContain("permission_risk");

    // fix the bypass and relax the hook rule -> only the hook remains, then clean
    fs.rmSync(path.join(project, ".claude", "settings.local.json"));
    expect(aem(home, ["check"], { expectFail: true })).not.toContain("ceiling.bypassPrompts");
    fs.writeFileSync(policyFile, policy.replace("PermissionRequest: deny", "PermissionRequest: review"));
    const clean = aem(home, ["check"]);
    expect(clean).toContain("No violations");

    // init --force regenerates the policy scaffold too
    aem(home, ["init", "--force"]);
    expect(fs.readFileSync(policyFile, "utf8")).toContain("PermissionRequest: deny");
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
