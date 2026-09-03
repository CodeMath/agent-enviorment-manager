import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { claudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { codexAdapter } from "../src/adapters/codex/index.js";
import { runDoctor } from "../src/core/doctor/doctor.js";
import { buildSnapshot } from "../src/core/snapshot.js";
import { snapshotToDesiredState } from "../src/core/desired.js";
import { detectDrift } from "../src/core/drift/drift.js";
import {
  ctxFor,
  makeTempHome,
  seedClaudePlugins,
  seedFixtureHome,
} from "./helpers.js";

describe("codex adapter", () => {
  test("reads fixture config into canonical model without secrets", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const ctx = ctxFor(home);

    const state = codexAdapter.read(ctx);
    expect(state.installed).toBe(true);
    expect(state.mcpServers.map((s) => s.id).sort()).toEqual([
      "github",
      "leaky",
      "shell",
    ]);

    const github = state.mcpServers.find((s) => s.id === "github")!;
    expect(github.command?.executable).toBe("npx");
    expect(github.env.GITHUB_TOKEN?.source).toBe("env");

    const leaky = state.mcpServers.find((s) => s.id === "leaky")!;
    expect(leaky.env.SERVICE_API_KEY?.source).toBe("inline");
    expect(leaky.env.SERVICE_API_KEY?.secret).toBe(true);
    expect(leaky.raw?.custom_field).toBe("keep-me"); // unknown field preserved

    // no secret value anywhere in the state
    expect(JSON.stringify(state)).not.toContain("sk-P2vyt");

    expect(state.skillPacks.map((s) => s.id)).toContain("ralph");
    expect(state.instructionPacks.length).toBeGreaterThan(0);
  });

  test("handles missing installation gracefully", () => {
    const home = makeTempHome();
    const state = codexAdapter.read(ctxFor(home));
    expect(state.installed).toBe(false);
    expect(state.mcpServers).toEqual([]);
  });

  test("parse failure becomes a warning, not a crash", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), "not = [valid");
    const state = codexAdapter.read(ctxFor(home));
    expect(state.warnings.length).toBeGreaterThan(0);
  });
});

describe("claude-code adapter", () => {
  test("reads user-scope mcpServers from ~/.claude.json", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const state = claudeCodeAdapter.read(ctxFor(home));
    expect(state.installed).toBe(true);
    expect(state.mcpServers.map((s) => s.id).sort()).toEqual([
      "leaky",
      "playwright",
    ]);
    expect(JSON.stringify(state)).not.toContain("sk-P2vyt");
    expect(state.skillPacks.map((s) => s.id)).toContain("reviewer");
  });

  test("reads project .mcp.json", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const project = path.join(home, "project");
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { proj: { command: "node", args: ["s.js"] } } }),
    );
    const state = claudeCodeAdapter.read(ctxFor(home, project));
    expect(state.mcpServers.map((s) => s.id)).toContain("proj");
  });

  test("no plugin registry means no plugins", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const state = claudeCodeAdapter.read(ctxFor(home));
    expect(state.plugins).toEqual([]);
  });
});

describe("claude-code plugins", () => {
  function world() {
    const home = makeTempHome();
    seedFixtureHome(home);
    seedClaudePlugins(home);
    const ctx = ctxFor(home);
    return { home, ctx, state: claudeCodeAdapter.read(ctx) };
  }

  test("reads registry, enabled flags, marketplace sources and components", () => {
    const { home, state } = world();
    // project-scope plugin bound to another repo is not part of this project
    expect(state.plugins.map((p) => p.id).sort()).toEqual([
      "discord@claude-plugins-official",
      "ghost@omc",
      "oh-my-claudecode@omc",
    ]);

    const omc = state.plugins.find((p) => p.id === "oh-my-claudecode@omc")!;
    expect(omc.name).toBe("oh-my-claudecode");
    expect(omc.marketplace).toBe("omc");
    expect(omc.marketplaceSource).toBe("https://github.com/Yeachan-Heo/oh-my-claudecode.git");
    expect(omc.version).toBe("5.1.0");
    expect(omc.scope).toBe("user");
    expect(omc.enabled).toBe(true);
    expect(omc.exists).toBe(true);
    expect(omc.components).toEqual({
      skills: 2,
      agents: 1,
      commands: 0,
      hooks: true,
      mcpServers: 1,
    });

    const discord = state.plugins.find((p) => p.id === "discord@claude-plugins-official")!;
    expect(discord.enabled).toBe(false);
    expect(discord.marketplaceSource).toBe("github:anthropics/claude-plugins-official");

    const ghost = state.plugins.find((p) => p.id === "ghost@omc")!;
    expect(ghost.exists).toBe(false);

    expect(state.configSources.map((s) => s.id)).toContain("claude-user-plugins");
    expect(state.warnings).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("sk-P2vyt");
    void home;
  });

  test("enabled plugin MCP servers are surfaced with plugin root expanded", () => {
    const { state } = world();
    const ids = state.mcpServers.map((s) => s.id);
    expect(ids).toContain("plugin:oh-my-claudecode:t");
    // disabled plugin contributes nothing at runtime
    expect(ids).not.toContain("plugin:discord:discord");

    const t = state.mcpServers.find((s) => s.id === "plugin:oh-my-claudecode:t")!;
    expect(t.managedBy).toBe("oh-my-claudecode@omc");
    expect(t.command?.executable).toBe("node");
    expect(t.command?.args[0]).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(t.command?.args[0]).toEndWith("/oh-my-claudecode/5.1.0/bridge/mcp-server.cjs");
    expect(t.sourcePath).toEndWith("/5.1.0/.mcp.json");
  });

  test("project settings layer overrides user enabledPlugins", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    seedClaudePlugins(home);
    const project = path.join(home, "project");
    fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { "oh-my-claudecode@omc": false } }),
    );
    const state = claudeCodeAdapter.read(ctxFor(home, project));
    expect(state.plugins.find((p) => p.id === "oh-my-claudecode@omc")?.enabled).toBe(false);
    expect(state.mcpServers.map((s) => s.id)).not.toContain("plugin:oh-my-claudecode:t");
  });

  test("plugin-managed servers are excluded from export and drift; plugins are exported", () => {
    const { ctx, state } = world();
    const snapshot = buildSnapshot([claudeCodeAdapter], ctx);
    const desired = snapshotToDesiredState(snapshot, "p");
    expect(desired.mcpServers.map((s) => s.id)).not.toContain("plugin:oh-my-claudecode:t");
    expect(desired.plugins.map((p) => p.id).sort()).toEqual(
      state.plugins.map((p) => p.id).sort(),
    );
    const omc = desired.plugins.find((p) => p.id === "oh-my-claudecode@omc")!;
    expect(omc).toMatchObject({
      marketplace: "omc",
      version: "5.1.0",
      scope: "user",
      enabled: true,
      applyTo: ["claude-code"],
    });

    // same world: clean
    expect(detectDrift(desired, snapshot, "p").items).toEqual([]);

    // profile expects a plugin that is not installed, a different version,
    // and does not know about one that is installed
    desired.plugins = desired.plugins.filter((p) => p.id !== "ghost@omc");
    desired.plugins.push({
      id: "code-review@claude-plugins-official",
      marketplace: "claude-plugins-official",
      marketplaceSource: "github:anthropics/claude-plugins-official",
      scope: "user",
      enabled: true,
      applyTo: ["claude-code"],
    });
    omc.version = "4.15.4";
    const report = detectDrift(desired, snapshot, "p");
    const keys = report.items.map((i) => `${i.kind}:${i.change}:${i.resourceRef}`);
    expect(keys).toContain("plugin:added:plugin.ghost@omc");
    expect(keys).toContain("plugin:removed:plugin.code-review@claude-plugins-official");
    expect(keys).toContain("plugin:changed:plugin.oh-my-claudecode@omc");
    const removed = report.items.find((i) => i.resourceRef === "plugin.code-review@claude-plugins-official")!;
    expect(removed.detail).toContain("claude plugin marketplace add anthropics/claude-plugins-official");
    expect(removed.detail).toContain("claude plugin install code-review@claude-plugins-official");
    const changed = report.items.find((i) => i.resourceRef === "plugin.oh-my-claudecode@omc")!;
    expect(changed.detail).toContain("version: 4.15.4 -> 5.1.0");
    // no mcp drift for the plugin-managed server
    expect(keys.filter((k) => k.includes("plugin:oh-my-claudecode:t"))).toEqual([]);
  });

  test("doctor flags missing installs and enabled-but-not-installed plugins", () => {
    const { ctx } = world();
    const snapshot = buildSnapshot([claudeCodeAdapter], ctx);
    const findings = runDoctor(snapshot, [claudeCodeAdapter], ctx);
    const byRef = (ref: string) => findings.filter((f) => f.resourceRef === ref);
    expect(byRef("plugin.ghost@omc").map((f) => [f.category, f.severity])).toEqual([
      ["broken_path", "error"],
    ]);
    expect(byRef("plugin.phantom@omc").map((f) => f.category)).toEqual(["unknown_config"]);
    expect(byRef("plugin.oh-my-claudecode@omc")).toEqual([]);
    expect(byRef("plugin.discord@claude-plugins-official")).toEqual([]);
  });
});

describe("doctor", () => {
  test("produces expected findings on the fixture environment", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const ctx = ctxFor(home);
    // GITHUB_TOKEN intentionally absent from ctx.env
    const snapshot = buildSnapshot([codexAdapter, claudeCodeAdapter], ctx);
    const findings = runDoctor(snapshot, [codexAdapter, claudeCodeAdapter], ctx);

    const categories = findings.map((f) => f.category);
    expect(categories).toContain("secret_inline"); // leaky servers
    expect(categories).toContain("missing_env"); // GITHUB_TOKEN not set
    expect(categories).toContain("dangerous_command"); // bash -c server

    const secretFindings = findings.filter((f) => f.category === "secret_inline");
    expect(secretFindings.length).toBeGreaterThanOrEqual(2); // codex + claude
    expect(JSON.stringify(findings)).not.toContain("sk-P2vyt");
  });

  test("one adapter failing does not block the other", () => {
    const home = makeTempHome();
    seedFixtureHome(home);
    const ctx = ctxFor(home);
    const broken = {
      ...codexAdapter,
      id: "broken",
      read() {
        throw new Error("boom");
      },
    };
    const snapshot = buildSnapshot([broken, claudeCodeAdapter], ctx);
    expect(snapshot.runtimes.find((r) => r.id === "broken")?.warnings[0]).toContain(
      "boom",
    );
    expect(
      snapshot.runtimes.find((r) => r.id === "claude-code")?.mcpServers.length,
    ).toBeGreaterThan(0);
  });
});
