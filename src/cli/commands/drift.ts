import { detectDrift } from "../../core/drift/drift.js";
import { dim, renderDrift } from "../../output/text.js";
import { scanNow } from "../common.js";
import { resolveDesired } from "./profile.js";

export function runDrift(opts: {
  profile?: string;
  vendor: string;
  json?: boolean;
}): void {
  const { name, desired, source } = resolveDesired(opts.profile);
  const { ctx, snapshot } = scanNow(opts.vendor);
  const report = detectDrift(desired, snapshot, name, ctx.project);
  if (!opts.json && source === "project") {
    process.stdout.write(
      dim(`Using project profile .aem/desired-state.yaml (scope: project)\n`),
    );
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderDrift(report) + "\n");
  }
  if (report.items.length > 0) process.exitCode = 3;
}
