import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { codexAdapter } from "../src/adapters/codex/index.js";
import { snapshotToDesiredState } from "../src/core/desired.js";
import { detectDrift } from "../src/core/drift/drift.js";
import { buildChangePlan } from "../src/core/planner/plan.js";
import { buildSnapshot } from "../src/core/snapshot.js";
import { ctxFor, makeTempHome, seedFixtureHome } from "./helpers.js";

const ADAPTERS = [codexAdapter, claudeCodeAdapter];

function fixtureWorld() {
  const home = makeTempHome();
  seedFixtureHome(home);
  const ctx = ctxFor(home);
  const snapshot = buildSnapshot(ADAPTERS, ctx);
  const desired = snapshotToDesiredState(snapshot, "test-profile");
  return { home, ctx, snapshot, desired };
}

describe("planner", () => {
  test("exported profile against same environment is all no-op", () => {
    const { ctx, snapshot, desired } = fixtureWorld();
    const plan = buildChangePlan(desired, snapshot, ADAPTERS, ctx, "test-profile");
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(plan.changes.every((c) => c.action === "noop")).toBe(true);
  });

  test("missing desired server is planned as add", () => {
    const { ctx, snapshot, desired } = fixtureWorld();
    desired.mcpServers.push({
      id: "newone",
      enabled: true,
      allowedRuntimes: ["codex"],
      transport: "stdio",
      command: { executable: "npx", args: ["-y", "newone-server"] },
      env: {},
    });
    const plan = buildChangePlan(desired, snapshot, ADAPTERS, ctx, "p");
    const add = plan.changes.find((c) => c.resourceRef === "mcp.newone");
    expect(add?.action).toBe("add");
    expect(add?.runtime).toBe("codex");
    expect(add?.backupRequired).toBe(true);
  });

  test("changed command is planned as update with detail", () => {
    const { ctx, snapshot, desired } = fixtureWorld();
    const github = desired.mcpServers.find((s) => s.id === "github")!;
    github.command = { executable: "bunx", args: github.command!.args };
    const plan = buildChangePlan(desired, snapshot, ADAPTERS, ctx, "p");
    const upd = plan.changes.find((c) => c.resourceRef === "mcp.github");
    expect(upd?.action).toBe("update");
    expect(upd?.detail?.join(" ")).toContain("bunx");
  });

  test("disabled desired server plans remove (claude) / disable (codex)", () => {
    const { ctx, snapshot, desired } = fixtureWorld();
    const leaky = desired.mcpServers.find((s) => s.id === "leaky")!;
    leaky.enabled = false;
    const plan = buildChangePlan(desired, snapshot, ADAPTERS, ctx, "p");
    const codexChange = plan.changes.find(
      (c) => c.resourceRef === "mcp.leaky" && c.runtime === "codex",
    );
    const claudeChange = plan.changes.find(
      (c) => c.resourceRef === "mcp.leaky" && c.runtime === "claude-code",
    );
    expect(codexChange?.action).toBe("update");
    expect(claudeChange?.action).toBe("remove");
  });
});

describe("desired-state merge", () => {
  test("same-id servers with divergent args stay per-runtime (no false drift)", () => {
    const { ctx, snapshot } = fixtureWorld();
    // simulate a vendor-specific variant of the same server id
    snapshot.runtimes
      .find((r) => r.id === "claude-code")!
      .mcpServers.push({
        id: "pencil",
        enabled: true,
        transport: "stdio",
        command: { executable: "/opt/pencil", args: ["--agent", "claudeCodeCLI"] },
        env: {},
        sourcePath: "x",
      });
    snapshot.runtimes
      .find((r) => r.id === "codex")!
      .mcpServers.push({
        id: "pencil",
        enabled: true,
        transport: "stdio",
        command: { executable: "/opt/pencil", args: ["--agent", "codexCLI"] },
        env: {},
        sourcePath: "y",
      });
    const desired = snapshotToDesiredState(snapshot, "p");
    const pencils = desired.mcpServers.filter((s) => s.id === "pencil");
    expect(pencils.length).toBe(2); // divergent variants kept separate
    const report = detectDrift(desired, snapshot, "p");
    expect(report.items.filter((i) => i.resourceRef === "mcp.pencil")).toEqual([]);
  });

  test("identical same-id servers are merged across runtimes", () => {
    const { snapshot } = fixtureWorld();
    const desired = snapshotToDesiredState(snapshot, "p");
    // playwright/leaky exist identically in both fixture vendors? leaky does
    const leaky = desired.mcpServers.filter((s) => s.id === "leaky");
    expect(leaky.length).toBe(1);
    expect(leaky[0]!.allowedRuntimes.sort()).toEqual(["claude-code", "codex"]);
  });
});

describe("drift", () => {
  test("no drift right after export", () => {
    const { ctx, snapshot, desired } = fixtureWorld();
    const report = detectDrift(desired, snapshot, "test-profile");
    expect(report.items).toEqual([]);
  });

  test("locally added server and removed skill are detected", () => {
    const { ctx, snapshot, desired } = fixtureWorld();
    // simulate: profile has fewer servers / more skills than reality
    desired.mcpServers = desired.mcpServers.filter((s) => s.id !== "shell");
    desired.skills.push({
      id: "gone-skill",
      type: "user",
      path: "~/.codex/skills/gone-skill",
      applyTo: ["codex"],
    });
    const report = detectDrift(desired, snapshot, "p");
    const kinds = report.items.map((i) => `${i.kind}:${i.change}:${i.resourceRef}`);
    expect(kinds).toContain("mcp:added:mcp.shell");
    expect(kinds).toContain("skill:removed:skill.gone-skill");
  });

  test("runtime version change is detected", () => {
    const { ctx, desired } = fixtureWorld();
    desired.metadata.observedRuntimeVersions = { codex: "0.1.0" };
    const snapshot2 = buildSnapshot(ADAPTERS, ctx);
    snapshot2.runtimes.find((r) => r.id === "codex")!.version = "0.2.0";
    const report = detectDrift(desired, snapshot2, "p");
    expect(
      report.items.some(
        (i) => i.kind === "runtime-version" && i.detail.includes("0.1.0 -> 0.2.0"),
      ),
    ).toBe(true);
  });
});
