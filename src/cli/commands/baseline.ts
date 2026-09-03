import fs from "node:fs";
import path from "node:path";
import { snapshotToDesiredState } from "../../core/desired.js";
import { detectDrift } from "../../core/drift/drift.js";
import type { DesiredState, DriftReport } from "../../core/model/types.js";
import { appendAudit } from "../../core/storage/audit.js";
import { backupFiles } from "../../core/storage/backup.js";
import { tildify } from "../../core/storage/paths.js";
import {
  profilePath,
  saveProfile,
  serializeDesiredState,
} from "../../core/storage/store.js";
import { bold, dim, green, renderDrift } from "../../output/text.js";
import { confirm, failWith, scanNow } from "../common.js";
import { projectProfilePath } from "./init.js";
import { resolveDesired } from "./profile.js";

export interface BaselineUpdateResult {
  kind: "BaselineUpdate";
  profile: string;
  source: "flag" | "project" | "active";
  target: string;
  backup?: string;
  accepted: DriftReport["items"];
}

/**
 * `aem baseline update`: accept the current environment as the new desired
 * state of the resolved profile. This is the "the drift is intentional"
 * counterpart of `apply` — instead of pushing the profile onto the machine,
 * it pulls the machine into the profile. The previous profile file is
 * backed up first and the acceptance is recorded in the audit log.
 */
export async function runBaselineUpdate(opts: {
  profile?: string;
  vendor: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  const { name, desired: previous, source } = resolveDesired(opts.profile);
  const { ctx, snapshot } = scanNow(opts.vendor);
  const report = detectDrift(previous, snapshot, name, ctx.project);
  const target =
    source === "project" ? projectProfilePath(ctx.project) : profilePath(name);

  if (report.items.length === 0) {
    if (opts.json) {
      const result: BaselineUpdateResult = {
        kind: "BaselineUpdate",
        profile: name,
        source,
        target,
        accepted: [],
      };
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(
        green(`Baseline "${name}" already matches the environment. Nothing to accept.\n`),
      );
    }
    return;
  }

  if (!opts.json) {
    process.stdout.write(renderDrift(report) + "\n\n");
    process.stdout.write(
      `These ${report.items.length} item(s) will be accepted into ${bold(tildify(target))}.\n`,
    );
  }
  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      failWith(
        "Refusing to update the baseline without confirmation in a non-interactive shell.",
        "Re-run with --yes to accept the current environment as the new baseline.",
      );
    }
    if (!(await confirm("Accept current environment as the new baseline?"))) {
      process.stdout.write(dim("Aborted. Baseline unchanged.\n"));
      return;
    }
  }

  const next: DesiredState = snapshotToDesiredState(snapshot, name, {
    description: previous.metadata.description,
    projectDir: ctx.project,
    scope: previous.metadata.scope ?? "user",
  });
  next.metadata.createdAt = previous.metadata.createdAt;
  next.metadata.updatedAt = new Date().toISOString();

  let backup: string | undefined;
  try {
    if (fs.existsSync(target)) backup = backupFiles("profiles", [target]);
    if (source === "project") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, serializeDesiredState(next));
    } else {
      saveProfile(next, { force: true });
    }
  } catch (err) {
    appendAudit({
      at: new Date().toISOString(),
      command: `baseline update --profile ${name}`,
      profile: name,
      result: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
    failWith(err instanceof Error ? err.message : String(err));
  }

  appendAudit({
    at: new Date().toISOString(),
    command: `baseline update --profile ${name}`,
    profile: name,
    changedFiles: [target],
    result: "ok",
    detail: `accepted ${report.items.length} drift item(s): ${report.items
      .map((i) => `${i.change} ${i.resourceRef}`)
      .join(", ")}`,
  });

  if (opts.json) {
    const result: BaselineUpdateResult = {
      kind: "BaselineUpdate",
      profile: name,
      source,
      target,
      backup,
      accepted: report.items,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    green(`Baseline "${name}" updated: `) +
      `${report.items.length} item(s) accepted -> ${bold(tildify(target))}\n`,
  );
  if (backup) process.stdout.write(dim(`Previous profile backed up to ${tildify(backup)}\n`));
}
