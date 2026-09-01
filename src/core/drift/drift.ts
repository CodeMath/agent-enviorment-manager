import type {
  DesiredState,
  DriftItem,
  DriftReport,
  EnvironmentSnapshot,
} from "../model/types.js";
import { SCHEMA_VERSION } from "../model/types.js";
import { diffServer } from "../planner/plan.js";

/**
 * Drift = differences between a saved profile (desired state) and the
 * current environment, including things apply would never touch:
 * extra MCP servers, instruction/skill add/remove, runtime version changes.
 */
export function detectDrift(
  desired: DesiredState,
  snapshot: EnvironmentSnapshot,
  profileName: string,
): DriftReport {
  const items: DriftItem[] = [];

  for (const runtime of snapshot.runtimes) {
    if (!runtime.installed) continue;
    const desiredForRuntime = desired.mcpServers.filter((d) =>
      d.allowedRuntimes.includes(runtime.id),
    );
    const desiredById = new Map(desiredForRuntime.map((d) => [d.id, d]));
    const currentById = new Map(runtime.mcpServers.map((s) => [s.id, s]));

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
      const diffs = diffServer(d, current);
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
    const currentInstrIds = new Set(runtime.instructionPacks.map((p) => p.id));
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
    for (const p of runtime.instructionPacks) {
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
    const currentSkillIds = new Set(runtime.skillPacks.map((s) => s.id));
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
    for (const s of runtime.skillPacks) {
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
