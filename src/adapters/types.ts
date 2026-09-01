import type {
  Change,
  DesiredMcpServer,
  Finding,
  RuntimeState,
} from "../core/model/types.js";

/**
 * Adapter contract (see _docs/03-mvp-functional-spec.md section 7).
 * Adapters never return secret values, never partially apply changes
 * they are not confident about, and always list backup targets first.
 */

export interface AdapterContext {
  /** user home directory (test-overridable) */
  home: string;
  /** project directory for project-scope discovery */
  project: string;
  /** current process env (for env presence checks) */
  env: Record<string, string | undefined>;
  /** allow spawning vendor binaries for version detection */
  allowExec: boolean;
}

export interface AdapterApplyResult {
  applied: Change[];
  failed: { change: Change; reason: string }[];
  changedFiles: string[];
}

export interface AgentRuntimeAdapter {
  id: string;
  displayName: string;
  adapterVersion: string;
  /** false = detect/doctor/drift only; planner and apply skip this vendor */
  canApply: boolean;

  /** discover + read vendor config into the canonical model */
  read(ctx: AdapterContext): RuntimeState;

  /** vendor-specific findings on top of the generic doctor checks */
  doctor(ctx: AdapterContext, state: RuntimeState): Finding[];

  /** files that must be backed up before the given changes are applied */
  backupTargets(ctx: AdapterContext, changes: Change[]): string[];

  /**
   * Apply MCP server changes to vendor-native config. Only servers with
   * this runtime in allowedRuntimes are passed in `desired`.
   */
  apply(
    ctx: AdapterContext,
    changes: Change[],
    desired: DesiredMcpServer[],
  ): AdapterApplyResult;

  /** vendor-native config path that MCP changes target */
  mcpConfigPath(ctx: AdapterContext): string;
}
