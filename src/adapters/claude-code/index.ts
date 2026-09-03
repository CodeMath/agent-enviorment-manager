import fs from "node:fs";
import path from "node:path";
import type {
  Change,
  DesiredMcpServer,
  Finding,
  McpServer,
  RuntimeState,
} from "../../core/model/types.js";
import {
  configSource,
  detectVersion,
  instructionPack,
  normalizeMcpBlock,
  skillPacksFromDir,
} from "../shared.js";
import type {
  AdapterApplyResult,
  AdapterContext,
  AgentRuntimeAdapter,
} from "../types.js";
import { materialize, materializeDeep } from "../../core/storage/paths.js";
import {
  installedPluginsPath,
  readClaudePlugins,
  readEnabledPlugins,
} from "./plugins.js";

const ADAPTER_VERSION = "0.1.0";

function claudeDir(ctx: AdapterContext): string {
  return path.join(ctx.home, ".claude");
}

/** ~/.claude.json holds user-scope mcpServers (plus large unrelated state). */
function userStatePath(ctx: AdapterContext): string {
  return path.join(ctx.home, ".claude.json");
}

function projectMcpPath(ctx: AdapterContext): string {
  return path.join(ctx.project, ".mcp.json");
}

function readJson(
  file: string,
  warnings: string[],
): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    warnings.push(
      `Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

function mcpServersFrom(
  doc: Record<string, unknown> | undefined,
  sourcePath: string,
  ctx: AdapterContext,
  warnings: string[],
): McpServer[] {
  if (!doc) return [];
  const table = doc.mcpServers;
  if (table === undefined) return [];
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    warnings.push(`Unexpected mcpServers shape in ${sourcePath}.`);
    return [];
  }
  const servers: McpServer[] = [];
  for (const [id, block] of Object.entries(table as Record<string, unknown>)) {
    if (block === null || typeof block !== "object") {
      warnings.push(`Skipping malformed mcpServers.${id} in ${sourcePath}.`);
      continue;
    }
    servers.push(
      normalizeMcpBlock(id, block as Record<string, unknown>, sourcePath, ctx.env),
    );
  }
  return servers;
}

export const claudeCodeAdapter: AgentRuntimeAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  adapterVersion: ADAPTER_VERSION,
  canApply: true,

  read(ctx: AdapterContext): RuntimeState {
    const warnings: string[] = [];
    const exec = detectVersion(ctx, "claude");
    const installed =
      exec.installed ||
      fs.existsSync(claudeDir(ctx)) ||
      fs.existsSync(userStatePath(ctx));

    const sources = [
      configSource(
        "claude-user-settings",
        "user",
        path.join(claudeDir(ctx), "settings.json"),
        "json",
      ),
      configSource("claude-user-state", "user", userStatePath(ctx), "json"),
      configSource(
        "claude-user-memory",
        "user",
        path.join(claudeDir(ctx), "CLAUDE.md"),
        "markdown",
      ),
      configSource(
        "claude-project-settings",
        "project",
        path.join(ctx.project, ".claude", "settings.json"),
        "json",
      ),
      configSource("claude-project-mcp", "project", projectMcpPath(ctx), "json"),
      configSource(
        "claude-project-memory",
        "project",
        path.join(ctx.project, "CLAUDE.md"),
        "markdown",
      ),
      configSource(
        "claude-user-skills",
        "user",
        path.join(claudeDir(ctx), "skills"),
        "directory",
      ),
      configSource(
        "claude-user-agents",
        "user",
        path.join(claudeDir(ctx), "agents"),
        "directory",
      ),
      configSource(
        "claude-user-plugins",
        "user",
        installedPluginsPath(ctx),
        "json",
      ),
    ].filter((s) => s.exists);

    const userState = readJson(userStatePath(ctx), warnings);
    const projectMcp = readJson(projectMcpPath(ctx), warnings);
    const pluginRead = installed
      ? readClaudePlugins(ctx, warnings)
      : { plugins: [], mcpServers: [] };
    const mcpServers = installed
      ? [
          ...mcpServersFrom(userState, userStatePath(ctx), ctx, warnings),
          ...mcpServersFrom(projectMcp, projectMcpPath(ctx), ctx, warnings),
          ...pluginRead.mcpServers,
        ]
      : [];

    const instructions = [
      instructionPack(
        "claude-user-memory",
        "user",
        path.join(claudeDir(ctx), "CLAUDE.md"),
      ),
      instructionPack(
        "claude-project-memory",
        "project",
        path.join(ctx.project, "CLAUDE.md"),
      ),
    ].filter((i) => i.exists);

    const skills = [
      ...skillPacksFromDir(path.join(claudeDir(ctx), "skills"), "user"),
      ...skillPacksFromDir(path.join(claudeDir(ctx), "agents"), "user"),
    ];

    return {
      id: "claude-code",
      name: "Claude Code",
      installed,
      version: exec.version,
      adapterVersion: ADAPTER_VERSION,
      configSources: sources,
      mcpServers,
      instructionPacks: installed ? instructions : [],
      skillPacks: installed ? skills : [],
      plugins: pluginRead.plugins,
      warnings,
    };
  },

  doctor(ctx: AdapterContext, state: RuntimeState): Finding[] {
    const findings: Finding[] = [];
    if (state.installed && !state.version) {
      findings.push({
        id: "claude-version-unknown",
        severity: "info",
        category: "unsupported_version",
        title: "Claude Code version unknown",
        message:
          "Claude Code appears installed but its version could not be determined.",
        runtime: "claude-code",
        suggestedAction: "Ensure `claude` is on PATH and runnable.",
      });
    }

    for (const plugin of state.plugins) {
      if (plugin.exists) continue;
      findings.push({
        id: `claude-plugin-missing-${plugin.id}`,
        severity: plugin.enabled ? "error" : "warning",
        category: "broken_path",
        title: `Plugin install missing: ${plugin.id}`,
        message: `Plugin "${plugin.id}" is registered in ${plugin.sourcePath} but its install directory ${plugin.path} does not exist.`,
        runtime: "claude-code",
        resourceRef: `plugin.${plugin.id}`,
        suggestedAction: `Run \`claude plugin install ${plugin.id}\` to reinstall, or \`claude plugin uninstall ${plugin.id}\` to drop the stale entry.`,
      });
    }

    if (state.installed) {
      const registered = new Set(state.plugins.map((p) => p.id));
      for (const [id, enabled] of readEnabledPlugins(ctx, [])) {
        if (!enabled || registered.has(id)) continue;
        findings.push({
          id: `claude-plugin-not-installed-${id}`,
          severity: "warning",
          category: "unknown_config",
          title: `Plugin enabled but not installed: ${id}`,
          message: `settings.json enables plugin "${id}" but it is not present in ${installedPluginsPath(ctx)}.`,
          runtime: "claude-code",
          resourceRef: `plugin.${id}`,
          suggestedAction: `Run \`claude plugin install ${id}\` or remove it from enabledPlugins.`,
        });
      }
    }
    return findings;
  },

  mcpConfigPath(ctx: AdapterContext): string {
    return userStatePath(ctx);
  },

  backupTargets(ctx: AdapterContext, changes: Change[]): string[] {
    if (changes.length === 0) return [];
    return [userStatePath(ctx)];
  },

  apply(
    ctx: AdapterContext,
    changes: Change[],
    desired: DesiredMcpServer[],
  ): AdapterApplyResult {
    const file = userStatePath(ctx);
    const applied: Change[] = [];
    const failed: AdapterApplyResult["failed"] = [];

    let doc: Record<string, unknown>;
    try {
      doc = fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
        : {};
    } catch (err) {
      return {
        applied: [],
        failed: changes.map((change) => ({
          change,
          reason: `cannot parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
        })),
        changedFiles: [],
      };
    }

    const table = (doc.mcpServers ?? {}) as Record<string, unknown>;
    doc.mcpServers = table;
    const desiredById = new Map(desired.map((d) => [d.id, d]));

    for (const change of changes) {
      const id = change.resourceRef.replace(/^mcp\./, "");
      const d = desiredById.get(id);
      try {
        if (change.action === "remove") {
          delete table[id];
        } else if (change.action === "add" || change.action === "update") {
          if (!d) throw new Error(`no desired entry for ${id}`);
          if (!d.enabled) {
            // Claude Code has no disabled flag; disabled means absent.
            delete table[id];
          } else {
            table[id] = renderClaudeMcpBlock(d, table[id], ctx.project);
          }
        } else {
          continue; // noop
        }
        applied.push(change);
      } catch (err) {
        failed.push({
          change,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (applied.length > 0) {
      fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    }
    return { applied, failed, changedFiles: applied.length > 0 ? [file] : [] };
  },
};

function renderClaudeMcpBlock(
  d: DesiredMcpServer,
  existing: unknown,
  projectDir?: string,
): Record<string, unknown> {
  const block: Record<string, unknown> =
    existing !== null && typeof existing === "object"
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (d.command) {
    block.command = materialize(d.command.executable, projectDir);
    block.args = d.command.args.map((a) => materialize(a, projectDir));
    delete block.url;
  } else if (d.url) {
    block.type = d.transport === "sse" ? "sse" : "http";
    block.url = d.url;
    delete block.command;
    delete block.args;
  }

  const env: Record<string, string> = {};
  for (const [name, ref] of Object.entries(d.env)) {
    if (ref.source === "inline" && ref.value !== undefined && ref.value !== "redacted") {
      env[name] = materialize(ref.value, projectDir);
    }
  }
  if (Object.keys(env).length > 0) block.env = env;
  else delete block.env;

  if (d.raw) Object.assign(block, materializeDeep(d.raw, projectDir));
  return block;
}
