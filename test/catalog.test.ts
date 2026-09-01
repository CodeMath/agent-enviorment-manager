import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { CATALOG_ADAPTERS, VENDOR_CATALOG } from "../src/adapters/catalog.js";
import { ALL_ADAPTERS, selectAdapters } from "../src/adapters/registry.js";
import { claudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { codexAdapter } from "../src/adapters/codex/index.js";
import { snapshotToDesiredState } from "../src/core/desired.js";
import { buildChangePlan } from "../src/core/planner/plan.js";
import { buildSnapshot } from "../src/core/snapshot.js";
import { ctxFor, makeTempHome } from "./helpers.js";

function byId(id: string) {
  const a = CATALOG_ADAPTERS.find((a) => a.id === id);
  if (!a) throw new Error(`no catalog adapter ${id}`);
  return a;
}

describe("vendor catalog", () => {
  test("all catalog adapters are read-only and registered", () => {
    expect(VENDOR_CATALOG.length).toBeGreaterThanOrEqual(10);
    for (const a of CATALOG_ADAPTERS) {
      expect(a.canApply).toBe(false);
      expect(ALL_ADAPTERS.some((x) => x.id === a.id)).toBe(true);
      expect(selectAdapters(a.id)[0]!.id).toBe(a.id);
    }
    expect(selectAdapters("factory")[0]!.id).toBe("droid"); // alias
  });

  test("gemini: standard mcpServers in settings.json", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".gemini", "settings.json"),
      JSON.stringify({
        security: { auth: { selectedType: "oauth-personal" } },
        mcpServers: {
          pencil: { command: "/opt/pencil/mcp", args: ["--agent", "geminiCLI"], env: {} },
        },
      }),
    );
    fs.writeFileSync(path.join(home, ".gemini", "GEMINI.md"), "# ctx\n");
    const state = byId("gemini").read(ctxFor(home));
    expect(state.installed).toBe(true);
    expect(state.mcpServers.map((s) => s.id)).toEqual(["pencil"]);
    expect(state.mcpServers[0]!.command?.executable).toBe("/opt/pencil/mcp");
    expect(state.instructionPacks.map((i) => i.id)).toContain("gemini-user-md");
  });

  test("opencode: array-command mcp entries are normalized", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".config", "opencode", "opencode.json"),
      JSON.stringify({
        mcp: {
          pencil: {
            command: ["/opt/pencil/mcp", "--agent", "openCodeCLI"],
            enabled: true,
            type: "local",
          },
          remote1: { type: "remote", url: "https://mcp.example.com", enabled: false },
        },
      }),
    );
    const state = byId("opencode").read(ctxFor(home));
    const pencil = state.mcpServers.find((s) => s.id === "pencil")!;
    expect(pencil.command?.executable).toBe("/opt/pencil/mcp");
    expect(pencil.command?.args).toEqual(["--agent", "openCodeCLI"]);
    expect(pencil.transport).toBe("stdio");
    const remote = state.mcpServers.find((s) => s.id === "remote1")!;
    expect(remote.url).toBe("https://mcp.example.com");
    expect(remote.enabled).toBe(false);
    expect(remote.transport).toBe("http");
  });

  test("amp: dotted literal key amp.mcpServers", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, ".config", "amp"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".config", "amp", "settings.json"),
      JSON.stringify({
        "amp.mcpServers": { srv: { command: "npx", args: ["-y", "srv"] } },
      }),
    );
    const state = byId("amp").read(ctxFor(home));
    expect(state.mcpServers.map((s) => s.id)).toEqual(["srv"]);
  });

  test("zed: context_servers with nested command object", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, ".config", "zed"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".config", "zed", "settings.json"),
      JSON.stringify({
        context_servers: {
          ctx7: { command: { path: "npx", args: ["-y", "ctx7"] } },
        },
      }),
    );
    const state = byId("zed").read(ctxFor(home));
    expect(state.mcpServers[0]!.command?.executable).toBe("npx");
    expect(state.mcpServers[0]!.command?.args).toEqual(["-y", "ctx7"]);
  });

  test("kiro: user + project mcp.json, user scope wins on duplicates", () => {
    const home = makeTempHome();
    const project = path.join(home, "project");
    fs.mkdirSync(path.join(home, ".kiro", "settings"), { recursive: true });
    fs.mkdirSync(path.join(project, ".kiro", "settings"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".kiro", "settings", "mcp.json"),
      JSON.stringify({ mcpServers: { dup: { command: "user-cmd", args: [] } } }),
    );
    fs.writeFileSync(
      path.join(project, ".kiro", "settings", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          dup: { command: "project-cmd", args: [] },
          only: { command: "p", args: [] },
        },
      }),
    );
    const state = byId("kiro").read(ctxFor(home, project));
    expect(state.mcpServers.find((s) => s.id === "dup")!.command?.executable).toBe(
      "user-cmd",
    );
    expect(state.mcpServers.map((s) => s.id).sort()).toEqual(["dup", "only"]);
  });

  test("not-installed vendor reports empty state", () => {
    const home = makeTempHome();
    const state = byId("qwen").read(ctxFor(home));
    expect(state.installed).toBe(false);
    expect(state.mcpServers).toEqual([]);
  });

  test("planner never plans changes for read-only vendors", () => {
    const home = makeTempHome();
    fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".gemini", "settings.json"),
      JSON.stringify({ mcpServers: { g1: { command: "npx", args: [] } } }),
    );
    const ctx = ctxFor(home);
    const adapters = [codexAdapter, claudeCodeAdapter, byId("gemini")];
    const snapshot = buildSnapshot(adapters, ctx);
    const desired = snapshotToDesiredState(snapshot, "p");
    // profile contains the gemini server...
    expect(desired.mcpServers.some((s) => s.allowedRuntimes.includes("gemini"))).toBe(
      true,
    );
    // ...but the plan must not touch gemini
    const plan = buildChangePlan(desired, snapshot, adapters, ctx, "p");
    expect(plan.changes.every((c) => c.runtime !== "gemini")).toBe(true);
  });
});
