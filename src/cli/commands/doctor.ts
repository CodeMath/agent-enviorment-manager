import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { runDoctor } from "../../core/doctor/doctor.js";
import { detectDrift } from "../../core/drift/drift.js";
import { loadPolicy, policyPath, runCheck } from "../../core/policy/policy.js";
import type { DesiredState, Finding } from "../../core/model/types.js";
import {
  listProfiles,
  loadProfile,
  validateDesiredState,
} from "../../core/storage/store.js";
import { SCHEMA_VERSION } from "../../core/model/types.js";
import { renderFindings } from "../../output/text.js";
import { failWith, scanNow } from "../common.js";

export function runDoctorCommand(opts: {
  json?: boolean;
  vendor: string;
  profile?: string;
  project?: string;
}): void {
  const { adapters, ctx, snapshot } = scanNow(opts.vendor, opts.project);
  const findings: Finding[] = runDoctor(snapshot, adapters, ctx);
  const policyFile = policyPath(ctx.project);
  if (fs.existsSync(policyFile)) {
    try {
      const policy = loadPolicy(policyFile);
      const report = runCheck(policy, snapshot, policy.metadata.name);
      let policyIndex = 0;
      for (const entry of report.items) {
        if (entry.severity !== "error" && entry.severity !== "warning") continue;
        policyIndex += 1;
        findings.push({
          id: `policy_${policyIndex}`,
          severity: entry.severity,
          category: "policy_violation",
          title: `Policy violation: ${entry.rule}`,
          message: entry.message,
          runtime: entry.runtime,
          resourceRef: entry.subject,
          suggestedAction: "Run `aem check` for details",
        });
      }
    } catch {
      /* policy validation is reported by aem check; doctor remains best-effort */
    }
  }

  // stale profile check across the local store
  for (const name of listProfiles()) {
    try {
      loadProfile(name);
    } catch (err) {
      findings.push({
        id: `stale-profile-${name}`,
        severity: "warning",
        category: "stale_profile",
        title: `Profile "${name}" failed validation`,
        message: err instanceof Error ? err.message : String(err),
        suggestedAction: `Re-export the profile with the current schema (${SCHEMA_VERSION}).`,
      });
    }
  }

  // drift check: explicit --profile, or the project baseline when present
  const projectFile = path.join(ctx.project, ".aem", "desired-state.yaml");
  let driftTarget: { name: string; desired: DesiredState } | undefined;
  if (opts.profile) {
    try {
      driftTarget = { name: opts.profile, desired: loadProfile(opts.profile) };
    } catch (err) {
      failWith(
        err instanceof Error ? err.message : String(err),
        "Run `aem profile list` to see available profiles.",
      );
    }
  } else if (fs.existsSync(projectFile)) {
    try {
      const desired = validateDesiredState(
        YAML.parse(fs.readFileSync(projectFile, "utf8")),
      );
      driftTarget = { name: desired.metadata.name, desired };
    } catch (err) {
      findings.push({
        id: "project-profile-invalid",
        severity: "warning",
        category: "stale_profile",
        title: "Invalid project profile",
        message: `${projectFile}: ${err instanceof Error ? err.message : String(err)}`,
        suggestedAction: "Fix the file or re-generate it with `aem init --force`.",
      });
    }
  }
  if (driftTarget) {
    const drift = detectDrift(
      driftTarget.desired,
      snapshot,
      driftTarget.name,
      ctx.project,
    );
    if (drift.items.length > 0) {
      findings.push({
        id: `drift-${driftTarget.name}`,
        severity: "warning",
        category: "drift_detected",
        title: `Drift from profile "${driftTarget.name}"`,
        message: `${drift.items.length} difference(s) between the current environment and the profile.`,
        suggestedAction: opts.profile
          ? `Run \`aem drift --profile ${driftTarget.name}\` for details.`
          : "Run `aem drift` for details.",
      });
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + "\n");
  } else {
    process.stdout.write(renderFindings(findings) + "\n");
  }

  const hasBlocking = findings.some(
    (f) => f.severity === "error" || f.severity === "critical",
  );
  if (hasBlocking) process.exitCode = 2;
}
