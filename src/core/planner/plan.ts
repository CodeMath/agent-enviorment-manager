import type { AdapterContext, AgentRuntimeAdapter } from "../../adapters/types.js";
import type {
  Change,
  ChangePlan,
  DesiredMcpServer,
  DesiredState,
  EnvironmentSnapshot,
  McpServer,
} from "../model/types.js";
import { SCHEMA_VERSION } from "../model/types.js";
import { materialize } from "../storage/paths.js";

/**
 * Shared planning engine: diff, apply --dry-run and apply all consume the
 * exact same ChangePlan. Only MCP servers are managed in the MVP;
 * instructions/skills are tracked read-only (see drift).
 *
 * Semantics:
 * - desired server present, current missing        -> add
 * - desired differs from current                   -> update
 * - desired enabled=false, current present         -> remove (vendor-native)
 * - current server not in profile                  -> untouched (reported by drift)
 */
export function buildChangePlan(
  desired: DesiredState,
  snapshot: EnvironmentSnapshot,
  adapters: AgentRuntimeAdapter[],
  ctx: AdapterContext,
  profileName: string,
): ChangePlan {
  const changes: Change[] = [];
  let seq = 0;
  const nextId = () => `change_${String(++seq).padStart(2, "0")}`;

  const targetRuntimes = new Set(
    desired.targets.runtimes.filter((r) => r.enabled).map((r) => r.id),
  );

  for (const adapter of adapters) {
    if (!adapter.canApply) continue; // read-only vendors: drift/doctor only
    if (!targetRuntimes.has(adapter.id)) continue;
    const runtime = snapshot.runtimes.find((r) => r.id === adapter.id);
    if (!runtime || !runtime.installed) continue;

    const targetPath = adapter.mcpConfigPath(ctx);
    const currentById = new Map(runtime.mcpServers.map((s) => [s.id, s]));

    for (const d of desired.mcpServers) {
      if (!d.allowedRuntimes.includes(adapter.id)) continue;
      const current = currentById.get(d.id);
      const ref = `mcp.${d.id}`;

      if (!current) {
        if (!d.enabled) continue; // disabled and absent: nothing to do
        changes.push({
          id: nextId(),
          runtime: adapter.id,
          action: "add",
          resourceRef: ref,
          targetPath,
          summary: `Add MCP server "${d.id}"`,
          risk: "low",
          backupRequired: true,
          detail: describeDesired(d),
        });
        continue;
      }

      if (!d.enabled && current.enabled) {
        changes.push({
          id: nextId(),
          runtime: adapter.id,
          action: adapter.id === "claude-code" ? "remove" : "update",
          resourceRef: ref,
          targetPath,
          summary:
            adapter.id === "claude-code"
              ? `Remove MCP server "${d.id}" (disabled in profile)`
              : `Disable MCP server "${d.id}"`,
          risk: "medium",
          backupRequired: true,
        });
        continue;
      }

      const diffs = diffServer(d, current);
      if (diffs.length > 0) {
        changes.push({
          id: nextId(),
          runtime: adapter.id,
          action: "update",
          resourceRef: ref,
          targetPath,
          summary: `Update MCP server "${d.id}"`,
          risk: "low",
          backupRequired: true,
          detail: diffs,
        });
      } else {
        changes.push({
          id: nextId(),
          runtime: adapter.id,
          action: "noop",
          resourceRef: ref,
          targetPath,
          summary: `MCP server "${d.id}" already matches`,
          risk: "low",
          backupRequired: false,
        });
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "ChangePlan",
    profile: profileName,
    generatedAt: new Date().toISOString(),
    changes,
  };
}

function describeDesired(d: DesiredMcpServer): string[] {
  const lines: string[] = [];
  if (d.command) {
    lines.push(
      `command: ${d.command.executable} ${d.command.args.join(" ")}`.trim(),
    );
  }
  if (d.url) lines.push(`url: ${d.url}`);
  const envRefs = Object.entries(d.env)
    .filter(([, v]) => v.source === "env")
    .map(([k]) => k);
  if (envRefs.length > 0) lines.push(`env refs: ${envRefs.join(", ")}`);
  return lines;
}

/** Compare a desired MCP server against current state; return human diffs. */
export function diffServer(d: DesiredMcpServer, c: McpServer): string[] {
  const diffs: string[] = [];

  const dExe = d.command ? materialize(d.command.executable) : undefined;
  const cExe = c.command?.executable;
  if (dExe !== cExe) {
    diffs.push(`command: ${cExe ?? "(none)"} -> ${dExe ?? "(none)"}`);
  }
  const dArgs = d.command ? d.command.args.map(materialize).join(" ") : "";
  const cArgs = c.command ? c.command.args.join(" ") : "";
  if (dArgs !== cArgs) {
    diffs.push(`args: [${cArgs}] -> [${dArgs}]`);
  }
  if ((d.url ?? "") !== (c.url ?? "")) {
    diffs.push(`url: ${c.url ?? "(none)"} -> ${d.url ?? "(none)"}`);
  }
  if (d.enabled !== c.enabled) {
    diffs.push(`enabled: ${c.enabled} -> ${d.enabled}`);
  }

  // env comparison is by name/source only; values are never compared or shown
  const dEnvNames = Object.keys(d.env).sort().join(",");
  const cEnvNames = Object.keys(c.env).sort().join(",");
  if (dEnvNames !== cEnvNames) {
    diffs.push(`env vars: [${cEnvNames}] -> [${dEnvNames}]`);
  }
  return diffs;
}
