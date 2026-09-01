import { detectDrift } from "../../core/drift/drift.js";
import { loadProfile } from "../../core/storage/store.js";
import { renderDrift } from "../../output/text.js";
import { failWith, scanNow } from "../common.js";
import { resolveProfileName } from "./profile.js";

export function runDrift(opts: {
  profile?: string;
  vendor: string;
  json?: boolean;
}): void {
  const name = resolveProfileName(opts.profile);
  let desired;
  try {
    desired = loadProfile(name);
  } catch (err) {
    failWith(err instanceof Error ? err.message : String(err));
  }
  const { snapshot } = scanNow(opts.vendor);
  const report = detectDrift(desired, snapshot, name);
  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderDrift(report) + "\n");
  }
  if (report.items.length > 0) process.exitCode = 3;
}
