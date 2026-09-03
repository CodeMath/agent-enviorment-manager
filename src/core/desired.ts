import path from "node:path";
import type {
  DesiredEnvVar,
  DesiredMcpServer,
  DesiredState,
  EnvironmentSnapshot,
  EnvVarRef,
} from "./model/types.js";
import { SCHEMA_VERSION } from "./model/types.js";
import { REDACTED } from "./redaction/redact.js";
import {
  portabilize,
  portabilizeDeep,
  relativeToDir,
  tildify,
} from "./storage/paths.js";

export interface DesiredStateOptions {
  description?: string;
  /** project directory used for ${PROJECT_ROOT} variable-ization */
  projectDir?: string;
  /**
   * user (default): full environment profile.
   * project: only resources that live inside projectDir (project MCP config,
   * project instructions/skills) — suitable for committing to the repo.
   */
  scope?: "user" | "project";
}

/**
 * Convert a current-state snapshot into a redacted, portable DesiredState.
 * - secret values are never carried over (only their reference shape)
 * - home paths become ~, project paths become ${PROJECT_ROOT} (embedded too)
 * - duplicate MCP ids across runtimes are merged with allowedRuntimes union
 */
export function snapshotToDesiredState(
  snapshot: EnvironmentSnapshot,
  name: string,
  opts: DesiredStateOptions = {},
): DesiredState {
  const { description, projectDir, scope = "user" } = opts;
  const projectOnly = scope === "project";
  const port = (value: string) => portabilize(value, projectDir);

  // Same-id servers are merged across runtimes only when their definitions
  // are equivalent; vendor-specific variants (e.g. different --agent args)
  // stay as separate entries with disjoint allowedRuntimes so drift does
  // not report false positives.
  const mcpEntries: DesiredMcpServer[] = [];

  const signature = (s: {
    command?: { executable: string; args: string[] };
    url?: string;
    enabled: boolean;
  }) =>
    JSON.stringify([
      s.command?.executable ?? null,
      s.command?.args ?? null,
      s.url ?? null,
      s.enabled,
    ]);

  for (const runtime of snapshot.runtimes) {
    for (const server of runtime.mcpServers) {
      // plugin-bundled servers are managed through the plugin entry
      if (server.managedBy) continue;
      if (
        projectOnly &&
        !(projectDir && relativeToDir(server.sourcePath, projectDir) !== undefined)
      ) {
        continue;
      }
      const desired: DesiredMcpServer = {
        id: server.id,
        enabled: server.enabled,
        allowedRuntimes: [runtime.id],
        transport: server.transport,
        command: server.command
          ? {
              executable: port(server.command.executable),
              args: server.command.args.map(port),
            }
          : undefined,
        url: server.url,
        env: desiredEnv(server.env, projectDir),
        raw: server.raw
          ? { [runtime.id]: portabilizeDeep(server.raw, projectDir) }
          : undefined,
      };
      const existing = mcpEntries.find(
        (e) => e.id === server.id && signature(e) === signature(desired),
      );
      if (existing) {
        if (!existing.allowedRuntimes.includes(runtime.id)) {
          existing.allowedRuntimes.push(runtime.id);
        }
        // keep this runtime's vendor-specific fields in its own bucket
        if (desired.raw) existing.raw = { ...existing.raw, ...desired.raw };
      } else {
        mcpEntries.push(desired);
      }
    }
  }

  const observedRuntimeVersions: Record<string, string> = {};
  for (const runtime of snapshot.runtimes) {
    if (runtime.version) observedRuntimeVersions[runtime.id] = runtime.version;
  }

  const projectRelative = (filePath: string): string | undefined => {
    if (!projectDir) return undefined;
    const rel = relativeToDir(filePath, projectDir);
    return rel === undefined ? undefined : "./" + rel;
  };

  const instructions = snapshot.runtimes.flatMap((r) =>
    r.instructionPacks
      .filter((p) => !projectOnly || p.type === "project")
      .map((p) => ({
        id: p.id,
        type: p.type,
        // project-scope paths are stored relative to the project root
        path:
          p.type === "project"
            ? (projectRelative(p.path) ?? p.path)
            : tildify(p.path),
        applyTo: [r.id],
      })),
  );

  const skills = snapshot.runtimes.flatMap((r) =>
    r.skillPacks
      .filter((s) => !projectOnly || s.type === "project")
      .map((s) => ({
        id: s.id,
        type: s.type,
        path:
          s.type === "project"
            ? (projectRelative(s.path) ?? tildify(s.path))
            : tildify(s.path),
        applyTo: [r.id],
      })),
  );

  const plugins = snapshot.runtimes.flatMap((r) =>
    r.plugins
      .filter((p) => !projectOnly || p.scope === "project")
      .map((p) => ({
        id: p.id,
        marketplace: p.marketplace,
        marketplaceSource: p.marketplaceSource,
        version: p.version,
        scope: p.scope,
        enabled: p.enabled,
        applyTo: [r.id],
      })),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "DesiredState",
    metadata: {
      name,
      description,
      createdAt: new Date().toISOString(),
      scope,
      observedRuntimeVersions: projectOnly ? undefined : observedRuntimeVersions,
    },
    targets: {
      runtimes: snapshot.runtimes
        .filter((r) => !projectOnly || r.installed)
        .map((r) => ({ id: r.id, enabled: r.installed })),
    },
    mcpServers: mcpEntries,
    instructions,
    skills,
    plugins,
    policies: {
      secretHandling: "forbid-inline",
      unknownFields: "preserve",
    },
  };
}

function desiredEnv(
  env: Record<string, EnvVarRef>,
  projectDir?: string,
): Record<string, DesiredEnvVar> {
  const out: Record<string, DesiredEnvVar> = {};
  for (const [name, ref] of Object.entries(env)) {
    if (ref.secret || ref.source === "env") {
      // secrets and env references become env-sourced requirements
      out[name] = { source: "env", required: true, value: REDACTED };
    } else {
      out[name] = {
        source: "inline",
        required: false,
        // machine-specific absolute paths are variable-ized, including
        // paths embedded inside larger values (e.g. JSON strings)
        value:
          ref.value === undefined ? undefined : portabilize(ref.value, projectDir),
      };
    }
  }
  return out;
}
