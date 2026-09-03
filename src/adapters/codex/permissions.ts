import path from "node:path";
import type { PermissionRule, PermissionSurface } from "../../core/model/types.js";
import { tildify } from "../../core/storage/paths.js";
import type { AdapterContext } from "../types.js";

const APPROVAL_POLICIES = new Set(["untrusted", "on-failure", "on-request", "never"]);
const SANDBOX_MODES = new Set(["read-only", "workspace-write", "danger-full-access"]);

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function setting(
  doc: Record<string, unknown>,
  profile: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return profile?.[key] ?? doc[key];
}

/**
 * Map Codex's approval and sandbox settings to the canonical permission surface.
 * Codex does not express shell granularity directly, so that field is lossy.
 */
export function readCodexPermissions(
  ctx: AdapterContext,
  doc: Record<string, unknown> | undefined,
  mcpServerIds: string[],
  warnings: string[],
): PermissionSurface {
  const file = path.join(ctx.home, ".codex", "config.toml");
  const config = doc ?? {};
  const profileName = typeof config.profile === "string" ? config.profile : undefined;
  const profiles = record(config.profiles);
  const profile = profileName === undefined ? undefined : record(profiles?.[profileName]);

  const configuredApproval = setting(config, profile, "approval_policy");
  const configuredSandbox = setting(config, profile, "sandbox_mode");
  let approvalDefaulted = configuredApproval === undefined;
  let sandboxDefaulted = configuredSandbox === undefined;
  let approval = "on-request";
  let sandbox = "workspace-write";

  if (typeof configuredApproval === "string") {
    if (APPROVAL_POLICIES.has(configuredApproval)) approval = configuredApproval;
    else {
      approvalDefaulted = true;
      warnings.push(`Unknown approval_policy "${configuredApproval}" in ${file}; using default.`);
    }
  } else if (configuredApproval !== undefined) {
    approvalDefaulted = true;
    warnings.push(`Unknown approval_policy "${String(configuredApproval)}" in ${file}; using default.`);
  }

  if (typeof configuredSandbox === "string") {
    if (SANDBOX_MODES.has(configuredSandbox)) sandbox = configuredSandbox;
    else {
      sandboxDefaulted = true;
      warnings.push(`Unknown sandbox_mode "${configuredSandbox}" in ${file}; using default.`);
    }
  } else if (configuredSandbox !== undefined) {
    sandboxDefaulted = true;
    warnings.push(`Unknown sandbox_mode "${String(configuredSandbox)}" in ${file}; using default.`);
  }

  const workspaceWrite = record(config.sandbox_workspace_write);
  const networkAccess = workspaceWrite?.network_access === true;
  const writableRoots = Array.isArray(workspaceWrite?.writable_roots)
    ? workspaceWrite.writable_roots.length
    : 0;
  const network =
    sandbox === "danger-full-access"
      ? true
      : sandbox === "workspace-write"
        ? networkAccess
        : false;
  const model = setting(config, profile, "model");
  const rules: PermissionRule[] = [
    { effect: "allow", pattern: `approval_policy=${approval}`, sourcePath: file },
    { effect: "allow", pattern: `sandbox_mode=${sandbox}`, sourcePath: file },
    {
      effect: "allow",
      pattern: `sandbox_workspace_write.writable_roots=${writableRoots} entries`,
      sourcePath: file,
    },
    { effect: "allow", pattern: `network_access=${networkAccess}`, sourcePath: file },
  ];
  if (typeof model === "string") {
    rules.push({ effect: "allow", pattern: `model=${model}`, sourcePath: file });
  }

  const projects = record(config.projects);
  const trustedProjects = Object.entries(projects ?? {})
    .filter(([, project]) => record(project)?.trust_level === "trusted")
    .map(([projectPath]) => tildify(projectPath));

  return {
    effective: {
      shell: sandbox === "danger-full-access" ? "full" : approval === "never" ? "allowlist" : "prompt",
      filesystem:
        sandbox === "read-only" ? "read" : sandbox === "danger-full-access" ? "full" : "workspace",
      network,
      mcp: mcpServerIds,
      bypassPrompts: approval === "never",
      ...(typeof model === "string" ? { model } : {}),
    },
    fidelity: {
      shell: "lossy",
      filesystem: "exact",
      network: "exact",
      mcp: "exact",
      bypassPrompts: "exact",
      ...(typeof model === "string" ? { model: "exact" as const } : {}),
    },
    mode: `${approval}/${sandbox}${approvalDefaulted && sandboxDefaulted ? " (default)" : ""}`,
    rules,
    ...(trustedProjects.length > 0 ? { trustedProjects } : {}),
  };
}
