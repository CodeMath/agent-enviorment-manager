import fs from "node:fs";
import path from "node:path";
import type {
  Change,
  ConfigSource,
  DesiredMcpServer,
  Finding,
  McpServer,
  RuntimeState,
} from "../core/model/types.js";
import {
  configSource,
  detectVersion,
  instructionPack,
  normalizeMcpBlock,
  skillPacksFromDir,
} from "./shared.js";
import type {
  AdapterApplyResult,
  AdapterContext,
  AgentRuntimeAdapter,
} from "./types.js";

/**
 * Declarative catalog of read-only vendor adapters.
 *
 * Vendor list cross-checked against the AI coding agent inventory maintained
 * by tokscale (https://github.com/junhoyeo/tokscale). These adapters
 * detect/normalize/doctor/drift only; apply stays exclusive to the
 * fully-supported codex and claude-code adapters.
 */

type McpStyle = "standard" | "opencode" | "zed";

interface PathRef {
  id: string;
  path: string; // relative to home (user scope) or project dir (project scope)
  scope: "user" | "project";
}

export interface VendorSpec {
  id: string;
  displayName: string;
  binary?: string;
  versionArgs?: string[];
  /** home-relative dirs/files whose existence implies installation */
  presence: string[];
  configFiles: (PathRef & { format: ConfigSource["format"] })[];
  mcp?: (PathRef & { key: string; style?: McpStyle })[];
  instructions?: PathRef[];
  skillsDirs?: PathRef[];
}

export const VENDOR_CATALOG: VendorSpec[] = [
  {
    id: "gemini",
    displayName: "Gemini CLI",
    binary: "gemini",
    presence: [".gemini"],
    configFiles: [
      { id: "gemini-user-settings", path: ".gemini/settings.json", scope: "user", format: "json" },
      { id: "gemini-project-settings", path: ".gemini/settings.json", scope: "project", format: "json" },
    ],
    mcp: [
      { id: "gemini-user-mcp", path: ".gemini/settings.json", scope: "user", key: "mcpServers" },
      { id: "gemini-project-mcp", path: ".gemini/settings.json", scope: "project", key: "mcpServers" },
    ],
    instructions: [
      { id: "gemini-user-md", path: ".gemini/GEMINI.md", scope: "user" },
      { id: "gemini-project-md", path: "GEMINI.md", scope: "project" },
    ],
  },
  {
    id: "qwen",
    displayName: "Qwen Code",
    binary: "qwen",
    presence: [".qwen"],
    configFiles: [
      { id: "qwen-user-settings", path: ".qwen/settings.json", scope: "user", format: "json" },
    ],
    mcp: [
      { id: "qwen-user-mcp", path: ".qwen/settings.json", scope: "user", key: "mcpServers" },
    ],
    instructions: [
      { id: "qwen-user-md", path: ".qwen/QWEN.md", scope: "user" },
      { id: "qwen-project-md", path: "QWEN.md", scope: "project" },
    ],
  },
  {
    id: "cursor",
    displayName: "Cursor",
    binary: "cursor-agent",
    presence: [".cursor"],
    configFiles: [
      { id: "cursor-user-mcp", path: ".cursor/mcp.json", scope: "user", format: "json" },
      { id: "cursor-project-mcp", path: ".cursor/mcp.json", scope: "project", format: "json" },
      { id: "cursor-project-rules", path: ".cursor/rules", scope: "project", format: "directory" },
    ],
    mcp: [
      { id: "cursor-user-mcp", path: ".cursor/mcp.json", scope: "user", key: "mcpServers" },
      { id: "cursor-project-mcp", path: ".cursor/mcp.json", scope: "project", key: "mcpServers" },
    ],
    instructions: [
      { id: "cursor-project-rules-file", path: ".cursorrules", scope: "project" },
    ],
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot CLI",
    binary: "copilot",
    presence: [".copilot"],
    configFiles: [
      { id: "copilot-user-config", path: ".copilot/config.json", scope: "user", format: "json" },
      { id: "copilot-user-mcp", path: ".copilot/mcp-config.json", scope: "user", format: "json" },
    ],
    mcp: [
      { id: "copilot-user-mcp", path: ".copilot/mcp-config.json", scope: "user", key: "mcpServers" },
    ],
    instructions: [
      { id: "copilot-project-instructions", path: ".github/copilot-instructions.md", scope: "project" },
    ],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    binary: "opencode",
    presence: [".config/opencode"],
    configFiles: [
      { id: "opencode-user-config", path: ".config/opencode/opencode.json", scope: "user", format: "json" },
      { id: "opencode-project-config", path: "opencode.json", scope: "project", format: "json" },
    ],
    mcp: [
      { id: "opencode-user-mcp", path: ".config/opencode/opencode.json", scope: "user", key: "mcp", style: "opencode" },
      { id: "opencode-project-mcp", path: "opencode.json", scope: "project", key: "mcp", style: "opencode" },
    ],
    instructions: [
      { id: "opencode-user-agents-md", path: ".config/opencode/AGENTS.md", scope: "user" },
    ],
  },
  {
    id: "amp",
    displayName: "Amp",
    binary: "amp",
    presence: [".amp", ".config/amp"],
    configFiles: [
      { id: "amp-user-settings", path: ".config/amp/settings.json", scope: "user", format: "json" },
    ],
    mcp: [
      { id: "amp-user-mcp", path: ".config/amp/settings.json", scope: "user", key: "amp.mcpServers" },
    ],
  },
  {
    id: "kiro",
    displayName: "Kiro",
    binary: "kiro-cli",
    presence: [".kiro"],
    configFiles: [
      { id: "kiro-user-mcp", path: ".kiro/settings/mcp.json", scope: "user", format: "json" },
      { id: "kiro-project-mcp", path: ".kiro/settings/mcp.json", scope: "project", format: "json" },
      { id: "kiro-project-steering", path: ".kiro/steering", scope: "project", format: "directory" },
    ],
    mcp: [
      { id: "kiro-user-mcp", path: ".kiro/settings/mcp.json", scope: "user", key: "mcpServers" },
      { id: "kiro-project-mcp", path: ".kiro/settings/mcp.json", scope: "project", key: "mcpServers" },
    ],
  },
  {
    id: "droid",
    displayName: "Factory Droid",
    binary: "droid",
    presence: [".factory"],
    configFiles: [
      { id: "droid-user-mcp", path: ".factory/mcp.json", scope: "user", format: "json" },
    ],
    mcp: [
      { id: "droid-user-mcp", path: ".factory/mcp.json", scope: "user", key: "mcpServers" },
    ],
  },
  {
    id: "goose",
    displayName: "Goose",
    binary: "goose",
    presence: [".config/goose"],
    configFiles: [
      { id: "goose-user-config", path: ".config/goose/config.yaml", scope: "user", format: "unknown" },
    ],
  },
  {
    id: "zed",
    displayName: "Zed Agent",
    binary: "zed",
    presence: [".config/zed"],
    configFiles: [
      { id: "zed-user-settings", path: ".config/zed/settings.json", scope: "user", format: "json" },
    ],
    mcp: [
      { id: "zed-user-mcp", path: ".config/zed/settings.json", scope: "user", key: "context_servers", style: "zed" },
    ],
  },
  {
    id: "crush",
    displayName: "Crush",
    binary: "crush",
    presence: [".config/crush", ".local/share/crush"],
    configFiles: [
      { id: "crush-user-config", path: ".config/crush/crush.json", scope: "user", format: "json" },
      { id: "crush-project-config", path: "crush.json", scope: "project", format: "json" },
      { id: "crush-project-config-hidden", path: ".crush.json", scope: "project", format: "json" },
    ],
    mcp: [
      { id: "crush-user-mcp", path: ".config/crush/crush.json", scope: "user", key: "mcp" },
      { id: "crush-project-mcp", path: "crush.json", scope: "project", key: "mcp" },
      { id: "crush-project-mcp-hidden", path: ".crush.json", scope: "project", key: "mcp" },
    ],
  },
  {
    id: "cline",
    displayName: "Cline",
    presence: [
      ".cline",
      "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev",
      ".config/Code/User/globalStorage/saoudrizwan.claude-dev",
    ],
    configFiles: [],
    mcp: [
      { id: "cline-mac-mcp", path: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json", scope: "user", key: "mcpServers" },
      { id: "cline-linux-mcp", path: ".config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json", scope: "user", key: "mcpServers" },
    ],
    instructions: [{ id: "cline-project-rules", path: ".clinerules", scope: "project" }],
  },
  {
    id: "roo-code",
    displayName: "Roo Code",
    presence: [
      "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline",
      ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    ],
    configFiles: [
      { id: "roo-project-rules", path: ".roo", scope: "project", format: "directory" },
    ],
    mcp: [
      { id: "roo-mac-mcp", path: "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json", scope: "user", key: "mcpServers" },
      { id: "roo-linux-mcp", path: ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json", scope: "user", key: "mcpServers" },
      { id: "roo-project-mcp", path: ".roo/mcp.json", scope: "project", key: "mcpServers" },
    ],
  },
  {
    id: "kilo",
    displayName: "Kilo Code",
    presence: [
      "Library/Application Support/Code/User/globalStorage/kilocode.kilo-code",
      ".config/Code/User/globalStorage/kilocode.kilo-code",
      ".local/share/kilo",
    ],
    configFiles: [],
    mcp: [
      { id: "kilo-mac-mcp", path: "Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/settings/mcp_settings.json", scope: "user", key: "mcpServers" },
      { id: "kilo-linux-mcp", path: ".config/Code/User/globalStorage/kilocode.kilo-code/settings/mcp_settings.json", scope: "user", key: "mcpServers" },
      { id: "kilo-project-mcp", path: ".kilocode/mcp.json", scope: "project", key: "mcpServers" },
    ],
  },
  {
    id: "grok",
    displayName: "Grok CLI",
    presence: [".grok"],
    configFiles: [
      { id: "grok-user-settings", path: ".grok/user-settings.json", scope: "user", format: "json" },
    ],
    mcp: [
      { id: "grok-user-mcp", path: ".grok/user-settings.json", scope: "user", key: "mcpServers" },
    ],
  },
  // ---- detect-tier vendors (presence/config detection; no MCP parsing) ----
  // Inventory cross-checked against tokscale's client list. Generic binary
  // names (pi, mux, fx, ...) are intentionally not probed to avoid false
  // positives from unrelated tools.
  { id: "openclaw", displayName: "OpenClaw", binary: "openclaw", presence: [".openclaw"], configFiles: [{ id: "openclaw-user-config", path: ".openclaw/openclaw.json", scope: "user", format: "json" }] },
  { id: "prime", displayName: "Prime Agent", presence: [".prime"], configFiles: [] },
  { id: "hermes", displayName: "Hermes Agent", presence: [".hermes"], configFiles: [] },
  { id: "pi", displayName: "Pi", presence: [".pi"], configFiles: [] },
  { id: "oh-my-pi", displayName: "Oh My Pi", binary: "omp", presence: [".omp"], configFiles: [] },
  { id: "senpi", displayName: "Senpi", binary: "senpi", presence: [".senpi"], configFiles: [] },
  { id: "kimchi", displayName: "Kimchi Coding", binary: "kimchi", presence: [".config/kimchi"], configFiles: [] },
  { id: "kimi", displayName: "Kimi CLI/Code", presence: [".kimi", ".kimi-code"], configFiles: [] },
  { id: "codebuff", displayName: "Codebuff", binary: "codebuff", presence: [".config/manicode"], configFiles: [] },
  { id: "antigravity", displayName: "Antigravity CLI", presence: [".gemini/antigravity-cli"], configFiles: [] },
  { id: "warp", displayName: "Warp", presence: [".warp"], configFiles: [] },
  { id: "devin", displayName: "Devin CLI", presence: [".local/share/devin"], configFiles: [] },
  { id: "augment", displayName: "Augment (Auggie)", binary: "auggie", presence: [".augment"], configFiles: [] },
  { id: "jcode", displayName: "Jcode", binary: "jcode", presence: [".jcode"], configFiles: [] },
  { id: "mimo", displayName: "MiMo Code", presence: [".local/share/mimocode"], configFiles: [] },
  { id: "junie", displayName: "Junie", presence: [".junie"], configFiles: [] },
  { id: "command-code", displayName: "Command Code", presence: [".commandcode"], configFiles: [] },
  { id: "zcode", displayName: "ZCode", binary: "zcode", presence: [".zcode"], configFiles: [] },
  { id: "opencodereview", displayName: "OpenCodeReview", presence: [".opencodereview"], configFiles: [] },
  { id: "codebuddy", displayName: "CodeBuddy", binary: "codebuddy", presence: [".codebuddy"], configFiles: [] },
  { id: "workbuddy", displayName: "WorkBuddy", presence: [".workbuddy"], configFiles: [] },
  { id: "deepseek-harness", displayName: "DeepSeek Harness", binary: "dsh", presence: [".dsh"], configFiles: [] },
  { id: "fx", displayName: "fx (Vercel)", presence: [".fx"], configFiles: [] },
  { id: "mux", displayName: "Mux", presence: [".mux"], configFiles: [] },
  { id: "gjc", displayName: "Gajae Code", binary: "gjc", presence: [".gjc"], configFiles: [] },
  { id: "lmstudio", displayName: "LM Studio", binary: "lms", presence: [".lmstudio"], configFiles: [] },
  { id: "octofriend", displayName: "Octofriend", binary: "octofriend", presence: [".config/octofriend"], configFiles: [{ id: "octofriend-user-config", path: ".config/octofriend/octofriend.json5", scope: "user", format: "unknown" }] },
  { id: "cherry-studio", displayName: "Cherry Studio", presence: ["Library/Application Support/CherryStudio", ".config/CherryStudio"], configFiles: [] },
];

function resolvePath(ctx: AdapterContext, ref: { path: string; scope: "user" | "project" }): string {
  return ref.scope === "user"
    ? path.join(ctx.home, ref.path)
    : path.join(ctx.project, ref.path);
}

/** Look up a (possibly literal-dotted) key: "amp.mcpServers" tries the literal first, then traverses. */
function getByKey(doc: Record<string, unknown>, key: string): unknown {
  if (key in doc) return doc[key];
  let node: unknown = doc;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Convert vendor-specific MCP entry shapes into the standard block shape. */
function toStandardBlock(
  block: Record<string, unknown>,
  style: McpStyle,
): Record<string, unknown> {
  if (style === "opencode") {
    // { type: local|remote, command: string[], environment, enabled, url }
    const cmd = Array.isArray(block.command) ? block.command.map(String) : undefined;
    return {
      command: cmd?.[0],
      args: cmd?.slice(1) ?? [],
      env: block.environment ?? block.env,
      enabled: block.enabled,
      url: block.url,
      type: block.type === "remote" ? "http" : block.type === "local" ? "stdio" : undefined,
    };
  }
  if (style === "zed") {
    // { command: {path, args, env} } or { command, args, env }
    const cmd = block.command;
    if (cmd !== null && typeof cmd === "object" && !Array.isArray(cmd)) {
      const c = cmd as Record<string, unknown>;
      return {
        command: c.path,
        args: c.args ?? [],
        env: c.env,
        enabled: block.enabled,
      };
    }
    return block;
  }
  return block;
}

function readMcp(
  ctx: AdapterContext,
  spec: VendorSpec,
  warnings: string[],
): McpServer[] {
  const servers: McpServer[] = [];
  const seen = new Set<string>();
  for (const ref of spec.mcp ?? []) {
    const file = resolvePath(ctx, ref);
    if (!fs.existsSync(file)) continue;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch (err) {
      warnings.push(
        `Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const table = getByKey(doc, ref.key);
    if (table === undefined) continue;
    if (table === null || typeof table !== "object" || Array.isArray(table)) {
      warnings.push(`Unexpected ${ref.key} shape in ${file}.`);
      continue;
    }
    for (const [id, block] of Object.entries(table as Record<string, unknown>)) {
      if (seen.has(id)) continue; // user scope wins over project duplicates
      if (block === null || typeof block !== "object") {
        warnings.push(`Skipping malformed ${ref.key}.${id} in ${file}.`);
        continue;
      }
      seen.add(id);
      servers.push(
        normalizeMcpBlock(
          id,
          toStandardBlock(block as Record<string, unknown>, ref.style ?? "standard"),
          file,
          ctx.env,
        ),
      );
    }
  }
  return servers;
}

export function createCatalogAdapter(spec: VendorSpec): AgentRuntimeAdapter {
  return {
    id: spec.id,
    displayName: spec.displayName,
    adapterVersion: "0.1.0",
    canApply: false,

    read(ctx: AdapterContext): RuntimeState {
      const warnings: string[] = [];
      const exec = spec.binary
        ? detectVersion(ctx, spec.binary, spec.versionArgs)
        : { installed: false as const, version: undefined };
      const installed =
        exec.installed ||
        spec.presence.some((p) => fs.existsSync(path.join(ctx.home, p)));

      const configSources = spec.configFiles
        .map((c) => configSource(c.id, c.scope, resolvePath(ctx, c), c.format))
        .filter((s) => s.exists);

      const instructions = (spec.instructions ?? [])
        .map((i) => instructionPack(i.id, i.scope, resolvePath(ctx, i)))
        .filter((i) => i.exists);

      const skills = (spec.skillsDirs ?? []).flatMap((d) =>
        skillPacksFromDir(resolvePath(ctx, d), d.scope),
      );

      return {
        id: spec.id,
        name: spec.displayName,
        installed,
        version: exec.version,
        adapterVersion: "0.1.0",
        configSources: installed ? configSources : [],
        mcpServers: installed ? readMcp(ctx, spec, warnings) : [],
        instructionPacks: installed ? instructions : [],
        skillPacks: installed ? skills : [],
        warnings,
      };
    },

    doctor(_ctx: AdapterContext, _state: RuntimeState): Finding[] {
      return []; // generic doctor checks cover normalized MCP servers
    },

    mcpConfigPath(ctx: AdapterContext): string {
      const first = spec.mcp?.[0];
      return first ? resolvePath(ctx, first) : "";
    },

    backupTargets(): string[] {
      return [];
    },

    apply(
      _ctx: AdapterContext,
      changes: Change[],
      _desired: DesiredMcpServer[],
    ): AdapterApplyResult {
      return {
        applied: [],
        failed: changes.map((change) => ({
          change,
          reason: `${spec.displayName} adapter is read-only (detect/doctor/drift only).`,
        })),
        changedFiles: [],
      };
    },
  };
}

export const CATALOG_ADAPTERS: AgentRuntimeAdapter[] =
  VENDOR_CATALOG.map(createCatalogAdapter);
