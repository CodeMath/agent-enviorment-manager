import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
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

const ADAPTER_VERSION = "0.1.0";

function codexDir(ctx: AdapterContext): string {
  return path.join(ctx.home, ".codex");
}

function configPath(ctx: AdapterContext): string {
  return path.join(codexDir(ctx), "config.toml");
}

function readMcpServers(
  ctx: AdapterContext,
  warnings: string[],
): McpServer[] {
  const file = configPath(ctx);
  if (!fs.existsSync(file)) return [];
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    warnings.push(
      `Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
  const table = doc.mcp_servers;
  if (table === undefined) return [];
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    warnings.push(`Unexpected mcp_servers shape in ${file}.`);
    return [];
  }
  const servers: McpServer[] = [];
  for (const [id, block] of Object.entries(table as Record<string, unknown>)) {
    if (block === null || typeof block !== "object") {
      warnings.push(`Skipping malformed mcp_servers.${id} in ${file}.`);
      continue;
    }
    servers.push(
      normalizeMcpBlock(id, block as Record<string, unknown>, file, ctx.env),
    );
  }
  return servers;
}

export const codexAdapter: AgentRuntimeAdapter = {
  id: "codex",
  displayName: "Codex",
  adapterVersion: ADAPTER_VERSION,
  canApply: true,

  read(ctx: AdapterContext): RuntimeState {
    const warnings: string[] = [];
    const exec = detectVersion(ctx, "codex");
    const installed = exec.installed || fs.existsSync(codexDir(ctx));

    const sources = [
      configSource("codex-user-config", "user", configPath(ctx), "toml"),
      configSource(
        "codex-user-agents-md",
        "user",
        path.join(codexDir(ctx), "AGENTS.md"),
        "markdown",
      ),
      configSource(
        "codex-home-agents-md",
        "user",
        path.join(ctx.home, "AGENTS.md"),
        "markdown",
      ),
      configSource(
        "codex-project-agents-md",
        "project",
        path.join(ctx.project, "AGENTS.md"),
        "markdown",
      ),
      configSource(
        "codex-user-skills",
        "user",
        path.join(codexDir(ctx), "skills"),
        "directory",
      ),
      configSource(
        "agents-shared-skills",
        "user",
        path.join(ctx.home, ".agents", "skills"),
        "directory",
      ),
    ].filter((s) => s.exists);

    const instructions = [
      instructionPack(
        "codex-user-agents-md",
        "user",
        path.join(codexDir(ctx), "AGENTS.md"),
      ),
      instructionPack("home-agents-md", "user", path.join(ctx.home, "AGENTS.md")),
      instructionPack(
        "project-agents-md",
        "project",
        path.join(ctx.project, "AGENTS.md"),
      ),
    ].filter((i) => i.exists);

    const skills = [
      ...skillPacksFromDir(path.join(codexDir(ctx), "skills"), "user"),
      ...skillPacksFromDir(path.join(ctx.home, ".agents", "skills"), "user"),
    ];
    // de-duplicate skills by id (codex reads both locations)
    const seen = new Set<string>();
    const dedupedSkills = skills.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    return {
      id: "codex",
      name: "Codex",
      installed,
      version: exec.version,
      adapterVersion: ADAPTER_VERSION,
      configSources: sources,
      mcpServers: installed ? readMcpServers(ctx, warnings) : [],
      instructionPacks: installed ? instructions : [],
      skillPacks: installed ? dedupedSkills : [],
      warnings,
    };
  },

  doctor(ctx: AdapterContext, state: RuntimeState): Finding[] {
    const findings: Finding[] = [];
    if (state.installed && !state.version) {
      findings.push({
        id: "codex-version-unknown",
        severity: "info",
        category: "unsupported_version",
        title: "Codex version unknown",
        message:
          "Codex appears installed but its version could not be determined; adapter runs in read-only-safe mode.",
        runtime: "codex",
        suggestedAction: "Ensure `codex` is on PATH and runnable.",
      });
    }
    return findings;
  },

  mcpConfigPath(ctx: AdapterContext): string {
    return configPath(ctx);
  },

  backupTargets(ctx: AdapterContext, changes: Change[]): string[] {
    if (changes.length === 0) return [];
    return [configPath(ctx)];
  },

  apply(
    ctx: AdapterContext,
    changes: Change[],
    desired: DesiredMcpServer[],
  ): AdapterApplyResult {
    const file = configPath(ctx);
    const applied: Change[] = [];
    const failed: AdapterApplyResult["failed"] = [];

    let doc: Record<string, unknown>;
    try {
      doc = fs.existsSync(file)
        ? (parseToml(fs.readFileSync(file, "utf8")) as Record<string, unknown>)
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

    const table = (doc.mcp_servers ?? {}) as Record<string, unknown>;
    doc.mcp_servers = table;
    const desiredById = new Map(desired.map((d) => [d.id, d]));

    for (const change of changes) {
      const id = change.resourceRef.replace(/^mcp\./, "");
      const d = desiredById.get(id);
      try {
        if (change.action === "remove") {
          delete table[id];
        } else if (change.action === "add" || change.action === "update") {
          if (!d) throw new Error(`no desired entry for ${id}`);
          table[id] = renderCodexMcpBlock(d, table[id], ctx.project);
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
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, stringifyToml(doc) + "\n");
    }
    return { applied, failed, changedFiles: applied.length > 0 ? [file] : [] };
  },
};

/** Render a desired MCP server as a codex `[mcp_servers.<id>]` block. */
function renderCodexMcpBlock(
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
    block.url = d.url;
    delete block.command;
    delete block.args;
  }
  block.enabled = d.enabled;

  const env: Record<string, string> = {};
  for (const [name, ref] of Object.entries(d.env)) {
    if (ref.source === "inline" && ref.value !== undefined && ref.value !== "redacted") {
      env[name] = materialize(ref.value, projectDir);
    }
    // env-sourced / secret vars are never written into vendor config
  }
  if (Object.keys(env).length > 0) block.env = env;
  else delete block.env;

  if (d.raw) Object.assign(block, materializeDeep(d.raw, projectDir));
  return block;
}
