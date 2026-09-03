import type {
  DesiredState,
  DriftItem,
  DriftReport,
  EnvironmentSnapshot,
} from "../model/types.js";
import { SCHEMA_VERSION } from "../model/types.js";
import { diffServer } from "../planner/plan.js";
import { isUnderDir } from "../storage/paths.js";

/**
 * Drift = differences between a saved profile (desired state) and the
 * current environment, including things apply would never touch:
 * extra MCP servers, instruction/skill add/remove, runtime version changes.
 *
 * Project-scoped profiles compare only project-scope resources: user-level
 * servers/instructions/skills are ignored so a repo baseline does not flag
 * every personal MCP server as drift.
 */
export function detectDrift(
  desired: DesiredState,
  snapshot: EnvironmentSnapshot,
  profileName: string,
  projectDir?: string,
): DriftReport {
  const items: DriftItem[] = [];
  const projectOnly = desired.metadata.scope === "project";

  for (const runtime of snapshot.runtimes) {
    if (!runtime.installed) continue;
    const desiredForRuntime = desired.mcpServers.filter((d) =>
      d.allowedRuntimes.includes(runtime.id),
    );
    const desiredById = new Map(desiredForRuntime.map((d) => [d.id, d]));
    const currentServers = runtime.mcpServers.filter(
      (s) =>
        !s.managedBy && // plugin-bundled servers drift via their plugin entry
        (!projectOnly || (projectDir && isUnderDir(s.sourcePath, projectDir))),
    );
    const currentById = new Map(currentServers.map((s) => [s.id, s]));

    for (const [id, current] of currentById) {
      const d = desiredById.get(id);
      if (!d) {
        items.push({
          runtime: runtime.id,
          kind: "mcp",
          change: "added",
          resourceRef: `mcp.${id}`,
          detail: `MCP server "${id}" exists locally but is not in the profile.`,
        });
        continue;
      }
      const diffs = diffServer(d, current, projectDir);
      if (diffs.length > 0) {
        items.push({
          runtime: runtime.id,
          kind: "mcp",
          change: "changed",
          resourceRef: `mcp.${id}`,
          detail: `MCP server "${id}" differs: ${diffs.join("; ")}`,
        });
      }
    }
    for (const [id, d] of desiredById) {
      if (!currentById.has(id) && d.enabled) {
        items.push({
          runtime: runtime.id,
          kind: "mcp",
          change: "removed",
          resourceRef: `mcp.${id}`,
          detail: `MCP server "${id}" is in the profile but missing locally.`,
        });
      }
    }

    // instructions (path-level presence + content hash changes are drift)
    const desiredInstr = desired.instructions.filter((i) =>
      i.applyTo.includes(runtime.id),
    );
    const currentInstrPacks = runtime.instructionPacks.filter(
      (p) => !projectOnly || p.type === "project",
    );
    const currentInstrIds = new Set(currentInstrPacks.map((p) => p.id));
    for (const i of desiredInstr) {
      if (!currentInstrIds.has(i.id)) {
        items.push({
          runtime: runtime.id,
          kind: "instruction",
          change: "removed",
          resourceRef: `instruction.${i.id}`,
          detail: `Instruction "${i.id}" (${i.path}) is in the profile but not detected locally.`,
        });
      }
    }
    const desiredInstrIds = new Set(desiredInstr.map((i) => i.id));
    for (const p of currentInstrPacks) {
      if (!desiredInstrIds.has(p.id)) {
        items.push({
          runtime: runtime.id,
          kind: "instruction",
          change: "added",
          resourceRef: `instruction.${p.id}`,
          detail: `Instruction "${p.id}" (${p.path}) exists locally but is not in the profile.`,
        });
      }
    }

    // skills
    const desiredSkills = desired.skills.filter((s) =>
      s.applyTo.includes(runtime.id),
    );
    const desiredSkillIds = new Set(desiredSkills.map((s) => s.id));
    const currentSkillPacks = runtime.skillPacks.filter(
      (s) => !projectOnly || s.type === "project",
    );
    const currentSkillIds = new Set(currentSkillPacks.map((s) => s.id));
    for (const s of desiredSkills) {
      if (!currentSkillIds.has(s.id)) {
        items.push({
          runtime: runtime.id,
          kind: "skill",
          change: "removed",
          resourceRef: `skill.${s.id}`,
          detail: `Skill "${s.id}" is in the profile but missing locally.`,
        });
      }
    }
    for (const s of currentSkillPacks) {
      if (!desiredSkillIds.has(s.id)) {
        items.push({
          runtime: runtime.id,
          kind: "skill",
          change: "added",
          resourceRef: `skill.${s.id}`,
          detail: `Skill "${s.id}" exists locally but is not in the profile.`,
        });
      }
    }

    // plugins (check-only: presence, enabled flag, version)
    const desiredPlugins = desired.plugins.filter((p) =>
      p.applyTo.includes(runtime.id),
    );
    const desiredPluginById = new Map(desiredPlugins.map((p) => [p.id, p]));
    const currentPlugins = runtime.plugins.filter(
      (p) => !projectOnly || p.scope === "project",
    );
    const currentPluginById = new Map(currentPlugins.map((p) => [p.id, p]));
    for (const d of desiredPlugins) {
      const c = currentPluginById.get(d.id);
      if (!c) {
        if (!d.enabled) continue;
        const hint =
          runtime.id === "claude-code"
            ? d.marketplaceSource
              ? ` Install with \`claude plugin marketplace add ${d.marketplaceSource.replace(/^github:/, "")}\` then \`claude plugin install ${d.id}\`.`
              : ` Install with \`claude plugin install ${d.id}\`.`
            : "";
        items.push({
          runtime: runtime.id,
          kind: "plugin",
          change: "removed",
          resourceRef: `plugin.${d.id}`,
          detail: `Plugin "${d.id}" is in the profile but not installed locally.${hint}`,
        });
        continue;
      }
      const diffs: string[] = [];
      if (d.enabled !== c.enabled) diffs.push(`enabled: ${c.enabled} -> ${d.enabled}`);
      if (d.version && c.version && d.version !== c.version) {
        diffs.push(`version: ${d.version} -> ${c.version}`);
      }
      if (diffs.length > 0) {
        items.push({
          runtime: runtime.id,
          kind: "plugin",
          change: "changed",
          resourceRef: `plugin.${d.id}`,
          detail: `Plugin "${d.id}" differs: ${diffs.join("; ")}`,
        });
      }
    }
    for (const c of currentPlugins) {
      if (!desiredPluginById.has(c.id)) {
        items.push({
          runtime: runtime.id,
          kind: "plugin",
          change: "added",
          resourceRef: `plugin.${c.id}`,
          detail: `Plugin "${c.id}"${c.version ? ` (${c.version})` : ""} is installed locally but is not in the profile.`,
        });
      }
    }

    // runtime version drift vs. version observed at export time
    const observed = desired.metadata.observedRuntimeVersions?.[runtime.id];
    if (observed && runtime.version && observed !== runtime.version) {
      items.push({
        runtime: runtime.id,
        kind: "runtime-version",
        change: "changed",
        resourceRef: `runtime.${runtime.id}`,
        detail: `Runtime version changed: ${observed} -> ${runtime.version}.`,
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "DriftReport",
    profile: profileName,
    generatedAt: new Date().toISOString(),
    items,
  };
}
