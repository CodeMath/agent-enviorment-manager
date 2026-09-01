import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { claudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { codexAdapter } from "../src/adapters/codex/index.js";
import { runDoctor } from "../src/core/doctor/doctor.js";
import { buildSnapshot } from "../src/core/snapshot.js";
import { ctxFor, makeTempHome, seedFixtureHome } from "./helpers.js";

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
