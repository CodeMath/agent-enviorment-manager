import { runDoctor } from "../../core/doctor/doctor.js";
import { detectDrift } from "../../core/drift/drift.js";
import type { Finding } from "../../core/model/types.js";
import { listProfiles, loadProfile } from "../../core/storage/store.js";
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

  if (opts.profile) {
    try {
      const desired = loadProfile(opts.profile);
      const drift = detectDrift(desired, snapshot, opts.profile);
      if (drift.items.length > 0) {
        findings.push({
          id: `drift-${opts.profile}`,
          severity: "warning",
          category: "drift_detected",
          title: `Drift from profile "${opts.profile}"`,
          message: `${drift.items.length} difference(s) between the current environment and the profile.`,
          suggestedAction: `Run \`aem drift --profile ${opts.profile}\` for details.`,
        });
      }
    } catch (err) {
      failWith(
        err instanceof Error ? err.message : String(err),
        "Run `aem profile list` to see available profiles.",
      );
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
