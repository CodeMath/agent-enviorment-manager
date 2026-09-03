import type {
  AgentDefinition,
  Capabilities,
  FilesystemAccess,
  ShellAccess,
} from "../model/types.js";

/**
 * Capability lattice helpers (see _docs/05-permission-layer.md section 4).
 * Ordered capabilities compare by rank; a missing value means "the vendor
 * does not express this" and is never treated as a violation by itself.
 */

export const SHELL_ORDER: ShellAccess[] = ["none", "prompt", "allowlist", "full"];
export const FILESYSTEM_ORDER: FilesystemAccess[] = ["read", "prompt", "workspace", "full"];

export function shellRank(v: ShellAccess): number {
  return SHELL_ORDER.indexOf(v);
}

export function filesystemRank(v: FilesystemAccess): number {
  return FILESYSTEM_ORDER.indexOf(v);
}

function minShell(a?: ShellAccess, b?: ShellAccess): ShellAccess | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return shellRank(a) <= shellRank(b) ? a : b;
}

function minFilesystem(
  a?: FilesystemAccess,
  b?: FilesystemAccess,
): FilesystemAccess | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return filesystemRank(a) <= filesystemRank(b) ? a : b;
}

/** Join (least upper bound) of two capability sets: the wider value wins. */
export function join(a: Capabilities, b: Capabilities): Capabilities {
  const out: Capabilities = {};
  if (a.shell !== undefined || b.shell !== undefined) {
    out.shell =
      a.shell === undefined
        ? b.shell
        : b.shell === undefined || shellRank(a.shell) >= shellRank(b.shell)
          ? a.shell
          : b.shell;
  }
  if (a.filesystem !== undefined || b.filesystem !== undefined) {
    out.filesystem =
      a.filesystem === undefined
        ? b.filesystem
        : b.filesystem === undefined || filesystemRank(a.filesystem) >= filesystemRank(b.filesystem)
          ? a.filesystem
          : b.filesystem;
  }
  if (a.network !== undefined || b.network !== undefined) out.network = a.network === true || b.network === true;
  if (a.bypassPrompts !== undefined || b.bypassPrompts !== undefined) {
    out.bypassPrompts = a.bypassPrompts === true || b.bypassPrompts === true;
  }
  if (a.mcp !== undefined || b.mcp !== undefined) out.mcp = [...new Set([...(a.mcp ?? []), ...(b.mcp ?? [])])];
  if (b.model ?? a.model) out.model = b.model ?? a.model;
  return out;
}

/** Meet (greatest lower bound) of two capability sets: the narrower wins per field. */
export function meet(a: Capabilities, b: Capabilities): Capabilities {
  const out: Capabilities = {};
  const shell = minShell(a.shell, b.shell);
  if (shell !== undefined) out.shell = shell;
  const filesystem = minFilesystem(a.filesystem, b.filesystem);
  if (filesystem !== undefined) out.filesystem = filesystem;
  if (a.network !== undefined || b.network !== undefined) {
    out.network = (a.network ?? true) && (b.network ?? true);
  }
  if (a.mcp !== undefined || b.mcp !== undefined) {
    out.mcp =
      a.mcp === undefined
        ? [...b.mcp!]
        : b.mcp === undefined
          ? [...a.mcp]
          : a.mcp.filter((id) => b.mcp!.includes(id));
  }
  if (a.bypassPrompts !== undefined || b.bypassPrompts !== undefined) {
    out.bypassPrompts = (a.bypassPrompts ?? false) && (b.bypassPrompts ?? false);
  }
  const model = b.model ?? a.model;
  if (model !== undefined) out.model = model;
  return out;
}

export interface Excess {
  capability: keyof Capabilities;
  actual: string;
  limit: string;
}

/**
 * Fields where `actual` exceeds `ceiling`. Missing fields on either side are
 * not violations (unconstrained / unexpressed).
 */
export function exceeds(actual: Capabilities, ceiling: Capabilities): Excess[] {
  const out: Excess[] = [];
  if (
    actual.shell !== undefined &&
    ceiling.shell !== undefined &&
    shellRank(actual.shell) > shellRank(ceiling.shell)
  ) {
    out.push({ capability: "shell", actual: actual.shell, limit: ceiling.shell });
  }
  if (
    actual.filesystem !== undefined &&
    ceiling.filesystem !== undefined &&
    filesystemRank(actual.filesystem) > filesystemRank(ceiling.filesystem)
  ) {
    out.push({ capability: "filesystem", actual: actual.filesystem, limit: ceiling.filesystem });
  }
  if (actual.network === true && ceiling.network === false) {
    out.push({ capability: "network", actual: "true", limit: "false" });
  }
  if (actual.bypassPrompts === true && ceiling.bypassPrompts === false) {
    out.push({ capability: "bypassPrompts", actual: "true", limit: "false" });
  }
  if (actual.mcp !== undefined && ceiling.mcp !== undefined) {
    const extra = actual.mcp.filter((id) => !ceiling.mcp!.includes(id));
    if (extra.length > 0) {
      out.push({ capability: "mcp", actual: extra.join(","), limit: ceiling.mcp.join(",") });
    }
  }
  return out;
}

export interface Shortfall {
  capability: keyof Capabilities;
  actual: string;
  required: string;
}

/** Fields where `actual` does not reach `requires` (role floor). */
export function lacks(
  actual: Capabilities,
  requires: Pick<Capabilities, "shell" | "filesystem" | "network" | "mcp">,
): Shortfall[] {
  const out: Shortfall[] = [];
  if (requires.shell !== undefined) {
    const have = actual.shell ?? "none";
    if (shellRank(have) < shellRank(requires.shell)) {
      out.push({ capability: "shell", actual: have, required: requires.shell });
    }
  }
  if (requires.filesystem !== undefined) {
    const have = actual.filesystem ?? "read";
    if (filesystemRank(have) < filesystemRank(requires.filesystem)) {
      out.push({ capability: "filesystem", actual: have, required: requires.filesystem });
    }
  }
  if (requires.network === true && actual.network === false) {
    out.push({ capability: "network", actual: "false", required: "true" });
  }
  if (requires.mcp !== undefined) {
    const have = actual.mcp ?? [];
    const missing = requires.mcp.filter((id) => !have.includes(id));
    if (missing.length > 0) {
      out.push({ capability: "mcp", actual: have.join(",") || "(none)", required: missing.join(",") });
    }
  }
  return out;
}

/* ------------------- tool-name -> capability narrowing ------------------- */

const SHELL_TOOLS = new Set(["bash", "shell", "terminal", "execute"]);
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "notebookedit"]);
const NETWORK_TOOLS = new Set(["webfetch", "websearch"]);

function toolBase(name: string): string {
  // "Bash(git *)" -> "bash", "mcp__github__search" -> "mcp__github__search"
  return name.replace(/\(.*\)$/, "").trim().toLowerCase();
}

/** MCP server id referenced by a vendor tool name (mcp__<server>__<tool>), if any. */
export function mcpServerOfTool(name: string): string | undefined {
  const m = toolBase(name).match(/^mcp__([^_]+(?:_[^_]+)*)__/);
  return m?.[1];
}

/**
 * Capabilities an agent definition can reach given the main agent's
 * effective capabilities: the agent's tool allow/deny lists only narrow.
 * Bash-restricting patterns ("Bash(git *)") cap shell at allowlist.
 */
export function narrowForAgent(
  main: Capabilities,
  agent: Pick<AgentDefinition, "tools" | "disallowedTools" | "model" | "permissionMode">,
): Capabilities {
  const agentCaps: Capabilities = {};

  if (agent.tools !== undefined) {
    const bases = agent.tools.map(toolBase);
    const shellEntries = agent.tools.filter((t) => SHELL_TOOLS.has(toolBase(t)));
    if (shellEntries.length === 0) agentCaps.shell = "none";
    else if (shellEntries.some((t) => /\(.*\)$/.test(t))) agentCaps.shell = "allowlist";
    if (!bases.some((b) => WRITE_TOOLS.has(b))) agentCaps.filesystem = "read";
    if (!bases.some((b) => NETWORK_TOOLS.has(b)) && agentCaps.shell === "none") {
      agentCaps.network = false;
    }
    const mcp = agent.tools.map(mcpServerOfTool).filter((s): s is string => s !== undefined);
    // an allowlist that names no MCP tool reaches no MCP server
    agentCaps.mcp = [...new Set(mcp)];
  }

  if (agent.disallowedTools !== undefined) {
    const bases = agent.disallowedTools.map(toolBase);
    if (bases.some((b) => SHELL_TOOLS.has(b))) agentCaps.shell = "none";
    if (bases.some((b) => WRITE_TOOLS.has(b))) agentCaps.filesystem = "read";
    const denied = new Set(
      agent.disallowedTools.map(mcpServerOfTool).filter((s): s is string => s !== undefined),
    );
    if (denied.size > 0 && agentCaps.mcp === undefined && main.mcp !== undefined) {
      agentCaps.mcp = main.mcp.filter((id) => !denied.has(id));
    }
  }

  if (agent.permissionMode === "bypassPermissions") agentCaps.bypassPrompts = true;
  if (agent.model !== undefined) agentCaps.model = agent.model;

  const merged = meet(main, agentCaps);
  // permissionMode can widen prompts only within what the main agent allows;
  // bypass is the one flag vendors let sub-agents raise, so keep it explicit
  if (agentCaps.bypassPrompts === true) merged.bypassPrompts = true;
  return merged;
}

export function describeCapabilities(c: Capabilities): string {
  const parts: string[] = [];
  if (c.shell !== undefined) parts.push(`shell=${c.shell}`);
  if (c.filesystem !== undefined) parts.push(`fs=${c.filesystem}`);
  if (c.network !== undefined) parts.push(`network=${c.network ? "yes" : "no"}`);
  if (c.bypassPrompts) parts.push("bypass-prompts");
  if (c.mcp !== undefined) parts.push(`mcp=${c.mcp.length}`);
  if (c.model !== undefined) parts.push(`model=${c.model}`);
  return parts.join(", ") || "(unexpressed)";
}
