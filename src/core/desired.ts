import type {
  DesiredEnvVar,
  DesiredMcpServer,
  DesiredState,
  EnvironmentSnapshot,
  EnvVarRef,
  McpServer,
} from "./model/types.js";
import { SCHEMA_VERSION } from "./model/types.js";
import { REDACTED } from "./redaction/redact.js";
import { tildify } from "./storage/paths.js";

/**
 * Convert a current-state snapshot into a redacted, portable DesiredState.
 * - secret values are never carried over (only their reference shape)
 * - machine-specific absolute paths are tildified
 * - duplicate MCP ids across runtimes are merged with allowedRuntimes union
 */
export function snapshotToDesiredState(
  snapshot: EnvironmentSnapshot,
  name: string,
  description?: string,
): DesiredState {
  const mcpById = new Map<string, DesiredMcpServer>();

  for (const runtime of snapshot.runtimes) {
    for (const server of runtime.mcpServers) {
      const existing = mcpById.get(server.id);
      if (existing) {
        if (!existing.allowedRuntimes.includes(runtime.id)) {
          existing.allowedRuntimes.push(runtime.id);
        }
        continue;
      }
      mcpById.set(server.id, {
        id: server.id,
        enabled: server.enabled,
        allowedRuntimes: [runtime.id],
        transport: server.transport,
        command: server.command
          ? {
              executable: tildify(server.command.executable),
              args: server.command.args.map((a) => tildify(a)),
            }
          : undefined,
        url: server.url,
        env: desiredEnv(server.env),
        raw: server.raw,
      });
    }
  }

  const observedRuntimeVersions: Record<string, string> = {};
  for (const runtime of snapshot.runtimes) {
    if (runtime.version) observedRuntimeVersions[runtime.id] = runtime.version;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "DesiredState",
    metadata: {
      name,
      description,
      createdAt: new Date().toISOString(),
      observedRuntimeVersions,
    },
    targets: {
      runtimes: snapshot.runtimes.map((r) => ({
        id: r.id,
        enabled: r.installed,
      })),
    },
    mcpServers: [...mcpById.values()],
    instructions: snapshot.runtimes.flatMap((r) =>
      r.instructionPacks.map((p) => ({
        id: p.id,
        type: p.type,
        path: p.type === "project" ? p.path : tildify(p.path),
        applyTo: [r.id],
      })),
    ),
    skills: snapshot.runtimes.flatMap((r) =>
      r.skillPacks.map((s) => ({
        id: s.id,
        type: s.type,
        path: tildify(s.path),
        applyTo: [r.id],
      })),
    ),
    policies: {
      secretHandling: "forbid-inline",
      unknownFields: "preserve",
    },
  };
}

function desiredEnv(
  env: Record<string, EnvVarRef>,
): Record<string, DesiredEnvVar> {
  const out: Record<string, DesiredEnvVar> = {};
  for (const [name, ref] of Object.entries(env)) {
    if (ref.secret || ref.source === "env") {
      // secrets and env references become env-sourced requirements
      out[name] = { source: "env", required: true, value: REDACTED };
    } else {
      out[name] = { source: "inline", required: false, value: ref.value };
    }
  }
  return out;
}
