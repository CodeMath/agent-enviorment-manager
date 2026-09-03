import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { codexAdapter } from "../src/adapters/codex/index.js";
import { ctxFor, makeTempHome } from "./helpers.js";

function readCodex(toml: string) {
  const home = makeTempHome();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), toml);
  return { home, state: codexAdapter.read(ctxFor(home)) };
}

test("maps Codex permission defaults", () => {
  const { state } = readCodex("");
  const permissions = state.permissions!;

  expect(permissions.mode).toBe("on-request/workspace-write (default)");
  expect(permissions.effective).toMatchObject({
    filesystem: "workspace",
    shell: "prompt",
    network: false,
    bypassPrompts: false,
  });
  expect(permissions.fidelity).toMatchObject({ shell: "lossy", filesystem: "exact" });
});

test("maps dangerous unattended Codex access", () => {
  const { state } = readCodex('approval_policy = "never"\nsandbox_mode = "danger-full-access"\n');

  expect(state.permissions!.effective).toMatchObject({
    shell: "full",
    filesystem: "full",
    network: true,
    bypassPrompts: true,
  });
});

test("reads workspace-write network access", () => {
  const { state } = readCodex(
    'sandbox_mode = "workspace-write"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
  );

  expect(state.permissions!.effective.network).toBe(true);
  expect(state.permissions!.rules).toContainEqual(
    expect.objectContaining({ pattern: "network_access=true" }),
  );
});

test("profile values override top-level Codex settings", () => {
  const { state } = readCodex(
    'profile = "safe"\nsandbox_mode = "workspace-write"\n\n[profiles.safe]\nsandbox_mode = "read-only"\n',
  );

  expect(state.permissions!.effective.filesystem).toBe("read");
});

test("reports trusted projects and enabled MCP servers only", () => {
  const home = makeTempHome();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "config.toml"),
    `[projects."${home}/a"]\ntrust_level = "trusted"\n\n[projects."${home}/b"]\ntrust_level = "untrusted"\n\n[mcp_servers.enabled]\ncommand = "node"\n\n[mcp_servers.disabled]\ncommand = "node"\nenabled = false\n`,
  );
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const state = codexAdapter.read(ctxFor(home));
    expect(state.permissions!.trustedProjects).toEqual(["~/a"]);
    expect(state.permissions!.effective.mcp).toEqual(["enabled"]);
  } finally {
    process.env.HOME = previousHome;
  }
});

test("falls back for unknown Codex sandbox modes", () => {
  const { state } = readCodex('sandbox_mode = "weird"\n');

  expect(state.permissions!.effective.filesystem).toBe("workspace");
  expect(state.warnings.some((warning) => warning.includes("weird"))).toBe(true);
});
