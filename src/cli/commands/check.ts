import fs from "node:fs";
import { hasViolations, loadPolicy, policyPath, runCheck } from "../../core/policy/policy.js";
import { untildify } from "../../core/storage/paths.js";
import type { CheckItem, CheckReport } from "../../core/model/types.js";
import { bold, dim, green, severityLabel } from "../../output/text.js";
import { failWith, scanNow } from "../common.js";

/**
 * Errors/warnings are listed individually. `review` hook infos are the bulk
 * of a typical report (one per registered hook), so they collapse into one
 * line per runtime/origin listing the events with counts.
 */
function renderCheck(report: CheckReport): string {
  const lines = [bold(`Policy check: ${report.policy}`), ""];
  const actionable = report.items.filter((i) => i.severity !== "info");
  const infos = report.items.filter((i) => i.severity === "info");

  if (actionable.length === 0) {
    lines.push(green("No violations. Local agents stay within the policy ceiling."));
  }
  let subject = "";
  for (const entry of actionable) {
    const label = `${entry.runtime} ${entry.subject}`;
    if (label !== subject) {
      subject = label;
      lines.push(bold(label));
    }
    lines.push(
      `  ${severityLabel(entry.severity)} ${entry.rule}${entry.fidelity ? dim(` [${entry.fidelity}]`) : ""}`,
    );
    lines.push(`    ${entry.message}`);
  }

  if (infos.length > 0) {
    lines.push("", dim(`${infos.length} hook(s) marked review:`));
    const groups = new Map<string, Map<string, number>>();
    for (const i of infos) {
      const origin = i.message.match(/^Hook from (\S+)/)?.[1] ?? "?";
      const key = `${i.runtime} ${origin}`;
      const events = groups.get(key) ?? new Map<string, number>();
      const event = i.subject.replace(/^hook:/, "");
      events.set(event, (events.get(event) ?? 0) + 1);
      groups.set(key, events);
    }
    for (const [key, events] of groups) {
      const list = [...events.entries()]
        .map(([e, n]) => (n > 1 ? `${e}×${n}` : e))
        .join(", ");
      lines.push(dim(`  ${key}: ${list}`));
    }
    lines.push(dim("  (use --json for commands)"));
  }

  const counts = ("critical error warning info".split(" ") as CheckItem["severity"][])
    .map((s) => [s, report.items.filter((i) => i.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  if (counts) lines.push("", dim(`Summary: ${counts}`));
  return lines.join("\n");
}

export function runCheckCommand(opts: { policy?: string; vendor: string; json?: boolean }): void {
  const file = opts.policy ? untildify(opts.policy) : policyPath(process.cwd());
  if (!fs.existsSync(file)) failWith(`No policy found at ${file}.`, "Run `aem init` to scaffold .aem/policy.yaml or pass --policy <file>.");
  let policy;
  try { policy = loadPolicy(file); } catch (err) { failWith(err instanceof Error ? err.message : String(err), "Fix the policy file and run `aem check` again."); }
  const { snapshot } = scanNow(opts.vendor);
  const report = runCheck(policy!, snapshot, policy!.metadata.name);
  process.stdout.write(opts.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderCheck(report)}\n`);
  if (hasViolations(report)) process.exitCode = 5;
}
