import { describe, expect, test } from "bun:test";
import type { EnvironmentSnapshot, RuntimeState } from "../src/core/model/types.js";
import { runDoctor } from "../src/core/doctor/doctor.js";
import { loadPolicy, runCheck, scaffoldPolicy, serializePolicy, validatePolicy, hasViolations } from "../src/core/policy/policy.js";
import { makeTempHome } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";

function runtime(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return { id: "claude", name: "Claude", installed: true, adapterVersion: "test", configSources: [], mcpServers: [], instructionPacks: [], skillPacks: [], plugins: [], hooks: [], agents: [], warnings: [], ...overrides };
}
function snapshot(runtimes: RuntimeState[]): EnvironmentSnapshot {
  return { schemaVersion: "aem.dev/v0", kind: "EnvironmentSnapshot", generatedAt: "2026-01-01T00:00:00Z", host: { os: "test", arch: "test", hostnameHash: "test" }, runtimes, findings: [] };
}
const metadata = { name: "test", createdAt: "2026-01-01T00:00:00Z" };

describe("policy", () => {
  test("validates schema and scaffold round-trips", () => {
    expect(() => validatePolicy({ schemaVersion: "aem.dev/v0", kind: "Nope", metadata, ceiling: {} })).toThrow();
    expect(() => validatePolicy({ schemaVersion: "aem.dev/v0", kind: "Policy", metadata, ceiling: { shell: "wide" } })).toThrow();
    expect(() => validatePolicy({ schemaVersion: "aem.dev/v0", kind: "Policy", metadata, ceiling: {}, hooks: { events: { PreToolUse: "bad" } } })).toThrow();
    expect(validatePolicy({ schemaVersion: "aem.dev/v0", kind: "Policy", metadata, ceiling: {} }).kind).toBe("Policy");
    const world = snapshot([
      runtime({ permissions: { effective: { shell: "allowlist", filesystem: "workspace", bypassPrompts: true, mcp: ["one"] }, fidelity: {}, rules: [] }, hooks: [{ event: "PermissionRequest", command: "approve", origin: "plugin:pack", sourcePath: "x" }], plugins: [{ id: "enabled", name: "enabled", marketplace: "x", scope: "user", enabled: true, path: "x", exists: true, components: { skills: 0, agents: 0, commands: 0, hooks: false, mcpServers: 0 }, sourcePath: "x" }] }),
      runtime({ id: "codex", permissions: { effective: { shell: "prompt", filesystem: "full", mcp: ["two"] }, fidelity: {}, rules: [] } }),
    ]);
    const policy = scaffoldPolicy(world, "project", "project");
    expect(policy.ceiling).toMatchObject({ shell: "allowlist", filesystem: "full", bypassPrompts: false });
    expect(policy.ceiling.mcp).toBeUndefined();
    expect(policy.hooks?.events?.PermissionRequest).toBe("deny");
    expect(policy.extensions?.plugins?.allow).toEqual(["enabled"]);
    const home = makeTempHome(); const file = path.join(home, "policy.yaml");
    fs.writeFileSync(file, serializePolicy(policy, { bypassCurrentlyOn: true }));
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("vendor-neutral permission ceiling");
    expect(text).toContain("currently TRUE locally");
    expect(serializePolicy(policy)).not.toContain("currently TRUE locally");
    expect(loadPolicy(file).ceiling.shell).toBe("allowlist");
  });

  test("checks main, agents, hooks and plugins", () => {
    const state = runtime({ permissions: { effective: { shell: "full", mcp: [] }, fidelity: { shell: "exact" }, rules: [] }, agents: [
      { id: "reader", origin: "user", path: "x", tools: ["Read"] },
      { id: "inherit", origin: "user", path: "x" },
      { id: "reviewer", origin: "user", path: "x", tools: ["Read"] },
    ], hooks: [
      { event: "PermissionRequest", command: "approve", origin: "plugin:pack", sourcePath: "x" },
      { event: "PreToolUse", command: "review", origin: "user", sourcePath: "x" },
    ], plugins: [
      { id: "other", name: "other", marketplace: "x", scope: "user", enabled: true, path: "x", exists: true, components: { skills: 0, agents: 0, commands: 0, hooks: false, mcpServers: 0 }, sourcePath: "x" },
      { id: "bad", name: "bad", marketplace: "x", scope: "user", enabled: true, path: "x", exists: true, components: { skills: 0, agents: 0, commands: 0, hooks: false, mcpServers: 0 }, sourcePath: "x" },
    ] });
    const policy = validatePolicy({ schemaVersion: "aem.dev/v0", kind: "Policy", metadata, ceiling: { shell: "allowlist" }, agents: { "*": { ceiling: { shell: "none" } }, reviewer: { requires: { mcp: ["github"] } } }, hooks: { events: { PermissionRequest: "deny", PreToolUse: "review" }, allowOrigins: ["user"] }, extensions: { plugins: { allow: ["bad"], deny: ["bad"] } } });
    const report = runCheck(policy, snapshot([state]), "test");
    expect(report.items.some((i) => i.rule === "ceiling.shell" && i.severity === "error")).toBe(true);
    expect(report.items.some((i) => i.rule === "agents.*.ceiling.shell" && i.subject === "agent:inherit")).toBe(true);
    expect(report.items.some((i) => i.subject === "agent:reader")).toBe(false);
    expect(report.items.some((i) => i.rule === "agents.reviewer.requires.mcp")).toBe(true);
    expect(report.items.some((i) => i.rule === "hooks.events.PermissionRequest" && i.severity === "error")).toBe(true);
    expect(report.items.some((i) => i.rule === "hooks.events.PreToolUse" && i.severity === "info")).toBe(true);
    expect(report.items.some((i) => i.rule === "hooks.allowOrigins")).toBe(true);
    expect(report.items.some((i) => i.rule === "extensions.plugins.allow")).toBe(true);
    expect(report.items.some((i) => i.rule === "extensions.plugins.deny" && i.severity === "error")).toBe(true);
    expect(hasViolations(report)).toBe(true);
    state.permissions!.fidelity.shell = "lossy";
    expect(runCheck(policy, snapshot([state]), "test").items.find((i) => i.rule === "ceiling.shell")?.severity).toBe("warning");
    expect(hasViolations({ ...report, items: report.items.filter((i) => i.severity !== "error") })).toBe(false);
  });

  test("doctor reports permission and hook risks only when present", () => {
    const risky = snapshot([runtime({ permissions: { effective: { bypassPrompts: true }, fidelity: {}, rules: [] }, hooks: [{ event: "PermissionRequest", command: "approve", origin: "plugin:pack", sourcePath: "x" }] })]);
    const findings = runDoctor(risky, [], { home: "/tmp", project: "/tmp", env: {}, allowExec: false });
    expect(findings.some((f) => f.category === "permission_risk" && f.severity === "critical")).toBe(true);
    expect(findings.some((f) => f.category === "hook_risk" && f.severity === "warning")).toBe(true);
    expect(runDoctor(snapshot([runtime({ permissions: { effective: {}, fidelity: {}, rules: [] } })]), [], { home: "/tmp", project: "/tmp", env: {}, allowExec: false })).toEqual([]);
  });
});
