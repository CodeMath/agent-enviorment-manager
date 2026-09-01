import { buildChangePlan } from "../../core/planner/plan.js";
import { appendAudit } from "../../core/storage/audit.js";
import { backupFiles } from "../../core/storage/backup.js";
import { loadProfile } from "../../core/storage/store.js";
import { tildify } from "../../core/storage/paths.js";
import { renderPlan, bold, dim, green, red } from "../../output/text.js";
import { confirm, failWith, scanNow, type ScanSetup } from "../common.js";
import { resolveProfileName } from "./profile.js";
import type { ChangePlan, DesiredState } from "../../core/model/types.js";

function planFor(
  profileFlag: string | undefined,
  vendor: string,
): { setup: ScanSetup; desired: DesiredState; plan: ChangePlan; name: string } {
  const name = resolveProfileName(profileFlag);
  let desired: DesiredState;
  try {
    desired = loadProfile(name);
  } catch (err) {
    failWith(
      err instanceof Error ? err.message : String(err),
      "Run `aem profile list` to see available profiles.",
    );
  }
  const setup = scanNow(vendor);
  const plan = buildChangePlan(desired, setup.snapshot, setup.adapters, setup.ctx, name);
  return { setup, desired, plan, name };
}

export function runDiff(opts: {
  profile?: string;
  vendor: string;
  json?: boolean;
}): void {
  const { plan } = planFor(opts.profile, opts.vendor);
  if (opts.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else {
    process.stdout.write(renderPlan(plan) + "\n");
  }
}

export async function runApply(opts: {
  profile?: string;
  vendor: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<void> {
  const { setup, desired, plan, name } = planFor(opts.profile, opts.vendor);
  const real = plan.changes.filter((c) => c.action !== "noop");

  process.stdout.write(renderPlan(plan, { dryRun: opts.dryRun }) + "\n");

  if (opts.dryRun || real.length === 0) return;

  if (!opts.yes) {
    const ok = await confirm(`Apply ${real.length} change(s)?`);
    if (!ok) {
      process.stdout.write("Aborted. No files were changed.\n");
      return;
    }
  }

  const changedFiles: string[] = [];
  const errors: string[] = [];
  const adapterVersions: Record<string, string> = {};

  for (const adapter of setup.adapters) {
    if (!adapter.canApply) continue;
    const changes = real.filter((c) => c.runtime === adapter.id);
    if (changes.length === 0) continue;
    adapterVersions[adapter.id] = adapter.adapterVersion;

    const targets = adapter.backupTargets(setup.ctx, changes);
    const backupRoot = backupFiles(adapter.id, targets);
    process.stdout.write(dim(`Backup: ${tildify(backupRoot)}\n`));

    const result = adapter.apply(
      setup.ctx,
      changes,
      desired.mcpServers.filter((m) => m.allowedRuntimes.includes(adapter.id)),
    );
    changedFiles.push(...result.changedFiles);
    for (const f of result.failed) {
      errors.push(`${f.change.resourceRef} (${adapter.id}): ${f.reason}`);
    }
    for (const c of result.applied) {
      process.stdout.write(`${green("applied")} ${c.summary} ${dim(`(${adapter.id})`)}\n`);
    }
  }

  appendAudit({
    at: new Date().toISOString(),
    command: `apply --profile ${name}`,
    profile: name,
    changedFiles,
    adapterVersions,
    result: errors.length === 0 ? "ok" : changedFiles.length > 0 ? "partial" : "error",
    detail: errors.length > 0 ? errors.join("; ") : undefined,
  });

  if (errors.length > 0) {
    process.stderr.write(red(bold("Some changes failed:")) + "\n");
    for (const e of errors) process.stderr.write(red(`- ${e}\n`));
    process.exitCode = 1;
  } else {
    process.stdout.write(
      green(bold(`Applied profile "${name}".`)) +
        ` ${changedFiles.length} file(s) changed.\n`,
    );
  }
}
