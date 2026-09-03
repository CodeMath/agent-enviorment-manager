import fs from "node:fs";
import path from "node:path";
import type {
  McpServer,
  PluginComponents,
  PluginPack,
} from "../../core/model/types.js";
import { normalizeMcpBlock } from "../shared.js";
import type { AdapterContext } from "../types.js";

/**
 * Claude Code plugin system (`~/.claude/plugins`).
 *
 * - `installed_plugins.json` is the registry: "<name>@<marketplace>" ->
 *   install records (scope user|project, installPath, version, sha).
 * - `known_marketplaces.json` maps marketplace name -> origin.
 * - `enabledPlugins` in settings.json (user, then project layers) toggles
 *   each plugin; a plugin that is installed but not enabled contributes
 *   nothing at runtime.
 * - Each install dir carries `.claude-plugin/plugin.json` plus optional
 *   `skills/`, `agents/`, `commands/`, `hooks/hooks.json` and `.mcp.json`.
 *   `.mcp.json` entries use `${CLAUDE_PLUGIN_ROOT}` for the install dir.
 */

const PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";

export function pluginsDir(ctx: AdapterContext): string {
  return path.join(ctx.home, ".claude", "plugins");
}

export function installedPluginsPath(ctx: AdapterContext): string {
  return path.join(pluginsDir(ctx), "installed_plugins.json");
}

function knownMarketplacesPath(ctx: AdapterContext): string {
  return path.join(pluginsDir(ctx), "known_marketplaces.json");
}

/** settings layers in precedence order (later wins) */
function settingsLayers(ctx: AdapterContext): string[] {
  return [
    path.join(ctx.home, ".claude", "settings.json"),
    path.join(ctx.home, ".claude", "settings.local.json"),
    path.join(ctx.project, ".claude", "settings.json"),
    path.join(ctx.project, ".claude", "settings.local.json"),
  ];
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

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Merged enabledPlugins map across all settings layers. */
export function readEnabledPlugins(
  ctx: AdapterContext,
  warnings: string[],
): Map<string, boolean> {
  const enabled = new Map<string, boolean>();
  for (const file of settingsLayers(ctx)) {
    const doc = readJson(file, warnings);
    const table = doc?.enabledPlugins;
    if (!isObject(table)) continue;
    for (const [id, value] of Object.entries(table)) {
      enabled.set(id, value === true);
    }
  }
  return enabled;
}

function readMarketplaceSources(
  ctx: AdapterContext,
  warnings: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const doc = readJson(knownMarketplacesPath(ctx), warnings);
  if (!doc) return out;
  for (const [name, entry] of Object.entries(doc)) {
    if (!isObject(entry) || !isObject(entry.source)) continue;
    const src = entry.source;
    const kind = typeof src.source === "string" ? src.source : "";
    if (kind === "github" && typeof src.repo === "string") {
      out.set(name, `github:${src.repo}`);
    } else if (typeof src.url === "string") {
      out.set(name, src.url);
    } else if (typeof src.path === "string") {
      out.set(name, src.path);
    }
  }
  return out;
}

interface InstallRecord {
  scope: "user" | "project";
  projectPath?: string;
  installPath: string;
  version?: string;
}

function toInstallRecords(value: unknown, id: string, file: string, warnings: string[]): InstallRecord[] {
  // v2: array of records; v1: a single record object
  const entries = Array.isArray(value) ? value : [value];
  const records: InstallRecord[] = [];
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.installPath !== "string") {
      warnings.push(`Skipping malformed plugin record ${id} in ${file}.`);
      continue;
    }
    records.push({
      scope: entry.scope === "project" || entry.scope === "local" ? "project" : "user",
      projectPath: typeof entry.projectPath === "string" ? entry.projectPath : undefined,
      installPath: entry.installPath,
      version: typeof entry.version === "string" ? entry.version : undefined,
    });
  }
  return records;
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function sameDir(a: string, b: string): boolean {
  return realpathOr(a) === realpathOr(b);
}

function countEntries(dir: string, pred: (e: fs.Dirent) => boolean): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(pred).length;
  } catch {
    return 0;
  }
}

function pluginMcpTable(
  installPath: string,
  warnings: string[],
): { table: Record<string, unknown>; sourcePath: string } | undefined {
  const mcpFile = path.join(installPath, ".mcp.json");
  const manifest = path.join(installPath, ".claude-plugin", "plugin.json");
  for (const [file, key] of [
    [mcpFile, "mcpServers"],
    [manifest, "mcpServers"],
  ] as const) {
    const doc = readJson(file, warnings);
    const table = doc?.[key];
    if (isObject(table)) return { table, sourcePath: file };
  }
  return undefined;
}

function components(
  installPath: string,
  mcpCount: number,
): PluginComponents {
  const isSkill = (e: fs.Dirent) => e.isDirectory() && !e.name.startsWith(".");
  const isMd = (e: fs.Dirent) => e.isFile() && e.name.endsWith(".md");
  return {
    skills: countEntries(path.join(installPath, "skills"), isSkill),
    agents: countEntries(path.join(installPath, "agents"), (e) => isMd(e) || isSkill(e)),
    commands: countEntries(path.join(installPath, "commands"), (e) => isMd(e) || isSkill(e)),
    hooks: fs.existsSync(path.join(installPath, "hooks", "hooks.json")),
    mcpServers: mcpCount,
  };
}

function substitutePluginRoot(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.split(PLUGIN_ROOT_VAR).join(root);
  if (Array.isArray(value)) return value.map((v) => substitutePluginRoot(v, root));
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitutePluginRoot(v, root);
    return out;
  }
  return value;
}

export interface ClaudePluginRead {
  plugins: PluginPack[];
  /** MCP servers bundled by enabled plugins (managedBy = plugin id) */
  mcpServers: McpServer[];
}

export function readClaudePlugins(
  ctx: AdapterContext,
  warnings: string[],
): ClaudePluginRead {
  const registryFile = installedPluginsPath(ctx);
  const registry = readJson(registryFile, warnings);
  const table = registry?.plugins;
  if (!isObject(table)) return { plugins: [], mcpServers: [] };

  const enabled = readEnabledPlugins(ctx, warnings);
  const sources = readMarketplaceSources(ctx, warnings);
  const plugins: PluginPack[] = [];
  const mcpServers: McpServer[] = [];

  for (const [id, value] of Object.entries(table)) {
    const at = id.lastIndexOf("@");
    const name = at > 0 ? id.slice(0, at) : id;
    const marketplace = at > 0 ? id.slice(at + 1) : "";

    for (const rec of toInstallRecords(value, id, registryFile, warnings)) {
      // project-scope installs belong to one repo; ignore other repos' plugins
      if (
        rec.scope === "project" &&
        rec.projectPath &&
        !sameDir(rec.projectPath, ctx.project)
      ) {
        continue;
      }
      const exists = fs.existsSync(rec.installPath);
      const isEnabled = enabled.get(id) === true;
      const mcp = exists ? pluginMcpTable(rec.installPath, warnings) : undefined;
      const mcpCount = mcp ? Object.keys(mcp.table).length : 0;

      plugins.push({
        id,
        name,
        marketplace,
        marketplaceSource: sources.get(marketplace),
        version: rec.version,
        scope: rec.scope,
        enabled: isEnabled,
        path: rec.installPath,
        exists,
        components: exists
          ? components(rec.installPath, mcpCount)
          : { skills: 0, agents: 0, commands: 0, hooks: false, mcpServers: 0 },
        sourcePath: registryFile,
      });

      if (!isEnabled || !mcp) continue;
      for (const [serverId, block] of Object.entries(mcp.table)) {
        if (!isObject(block)) {
          warnings.push(`Skipping malformed mcpServers.${serverId} in ${mcp.sourcePath}.`);
          continue;
        }
        const server = normalizeMcpBlock(
          `plugin:${name}:${serverId}`,
          substitutePluginRoot(block, rec.installPath) as Record<string, unknown>,
          mcp.sourcePath,
          ctx.env,
        );
        server.managedBy = id;
        mcpServers.push(server);
      }
    }
  }
  return { plugins, mcpServers };
}
