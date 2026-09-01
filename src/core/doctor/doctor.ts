import fs from "node:fs";
import path from "node:path";
import type { AdapterContext, AgentRuntimeAdapter } from "../../adapters/types.js";
import type {
  EnvironmentSnapshot,
  Finding,
  McpServer,
} from "../model/types.js";

const DANGEROUS_EXECUTABLES = new Set(["bash", "sh", "zsh", "fish", "cmd", "powershell"]);
const DANGEROUS_ARG_PATTERNS = [/rm\s+-rf/, /--dangerously/, /sudo\s/];

function isOnPath(executable: string, env: Record<string, string | undefined>): boolean {
  if (executable.includes("/")) return fs.existsSync(executable);
  const pathVar = env.PATH ?? "";
  return pathVar
    .split(":")
    .filter(Boolean)
    .some((dir) => {
      try {
        return fs.existsSync(path.join(dir, executable));
      } catch {
        return false;
      }
    });
}

let findingSeq = 0;
function finding(f: Omit<Finding, "id">): Finding {
  findingSeq += 1;
  return { id: `finding_${String(findingSeq).padStart(2, "0")}`, ...f };
}

export function resetFindingCounter(): void {
  findingSeq = 0;
}

function mcpFindings(
  runtime: string,
  server: McpServer,
  ctx: AdapterContext,
): Finding[] {
  const out: Finding[] = [];
  const ref = `mcp.${server.id}`;

  for (const [name, envRef] of Object.entries(server.env)) {
    if (envRef.source === "inline" && envRef.secret) {
      out.push(
        finding({
          severity: "critical",
          category: "secret_inline",
          title: `Inline secret in ${server.id} (${name})`,
          message: `MCP server "${server.id}" stores a secret-looking value for ${name} directly in ${server.sourcePath}.`,
          runtime,
          resourceRef: ref,
          suggestedAction: `Move ${name} into your shell environment and reference it instead of hardcoding the value.`,
        }),
      );
    }
    if (envRef.source === "env" && envRef.present === false) {
      out.push(
        finding({
          severity: "warning",
          category: "missing_env",
          title: `Missing env var for ${server.id}`,
          message: `MCP server "${server.id}" references ${name} but it is not set in the current environment.`,
          runtime,
          resourceRef: ref,
          suggestedAction: `Export ${name} in your shell profile or disable this MCP server.`,
        }),
      );
    }
  }

  if (server.command) {
    const exe = server.command.executable;
    if (!isOnPath(exe, ctx.env)) {
      out.push(
        finding({
          severity: "error",
          category: "broken_path",
          title: `Broken command for ${server.id}`,
          message: `MCP server "${server.id}" runs "${exe}" which was not found${exe.includes("/") ? "" : " on PATH"}.`,
          runtime,
          resourceRef: ref,
          suggestedAction: `Install ${exe} or fix the command path in ${server.sourcePath}.`,
        }),
      );
    }
    const argLine = server.command.args.join(" ");
    if (
      DANGEROUS_EXECUTABLES.has(path.basename(exe)) ||
      DANGEROUS_ARG_PATTERNS.some((p) => p.test(argLine))
    ) {
      out.push(
        finding({
          severity: "warning",
          category: "dangerous_command",
          title: `Broad shell access via ${server.id}`,
          message: `MCP server "${server.id}" executes a shell (or shell-escape arguments), granting broad command execution.`,
          runtime,
          resourceRef: ref,
          suggestedAction: `Review whether "${server.id}" really needs raw shell access; scope it down if possible.`,
        }),
      );
    }
  }
  return out;
}

/**
 * Cross-vendor + per-server doctor. Adapter-specific findings are appended
 * via each adapter's doctor() hook; adapter failure never aborts the run.
 */
export function runDoctor(
  snapshot: EnvironmentSnapshot,
  adapters: AgentRuntimeAdapter[],
  ctx: AdapterContext,
): Finding[] {
  resetFindingCounter();
  const findings: Finding[] = [];

  for (const runtime of snapshot.runtimes) {
    for (const server of runtime.mcpServers) {
      findings.push(...mcpFindings(runtime.id, server, ctx));
    }
    for (const pack of runtime.instructionPacks) {
      if (!pack.exists) {
        findings.push(
          finding({
            severity: "warning",
            category: "broken_path",
            title: `Missing instruction file`,
            message: `Instruction file ${pack.path} is referenced but does not exist.`,
            runtime: runtime.id,
            resourceRef: `instruction.${pack.id}`,
          }),
        );
      }
    }
    for (const warning of runtime.warnings) {
      findings.push(
        finding({
          severity: "warning",
          category: "unknown_config",
          title: `Unparsed config (${runtime.id})`,
          message: warning,
          runtime: runtime.id,
          suggestedAction:
            "Fix the config file syntax, or report the format so the adapter can support it.",
        }),
      );
    }
  }

  // duplicate MCP ids across runtimes with differing commands
  const byId = new Map<string, { runtime: string; server: McpServer }[]>();
  for (const runtime of snapshot.runtimes) {
    for (const server of runtime.mcpServers) {
      const list = byId.get(server.id) ?? [];
      list.push({ runtime: runtime.id, server });
      byId.set(server.id, list);
    }
  }
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    const commands = new Set(
      entries.map((e) =>
        e.server.command
          ? `${e.server.command.executable} ${e.server.command.args.join(" ")}`
          : (e.server.url ?? "?"),
      ),
    );
    if (commands.size > 1) {
      findings.push(
        finding({
          severity: "warning",
          category: "duplicate_mcp",
          title: `Divergent duplicate MCP "${id}"`,
          message: `MCP server "${id}" is defined in ${entries
            .map((e) => e.runtime)
            .join(", ")} with different commands.`,
          resourceRef: `mcp.${id}`,
          suggestedAction: `Align the "${id}" definitions or manage it from a single aem profile.`,
        }),
      );
    }
  }

  for (const adapter of adapters) {
    const state = snapshot.runtimes.find((r) => r.id === adapter.id);
    if (!state) continue;
    try {
      findings.push(...adapter.doctor(ctx, state));
    } catch {
      /* adapter doctor failure is non-fatal */
    }
  }

  return findings;
}
