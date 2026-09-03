import type {
  ChangePlan,
  DriftReport,
  EnvironmentSnapshot,
  Finding,
  Severity,
} from "../core/model/types.js";
import { tildify } from "../core/storage/paths.js";

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

function paint(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const bold = (t: string) => paint("1", t);
export const dim = (t: string) => paint("2", t);
export const green = (t: string) => paint("32", t);
export const yellow = (t: string) => paint("33", t);
export const red = (t: string) => paint("31", t);
export const cyan = (t: string) => paint("36", t);

export function severityLabel(severity: Severity): string {
  switch (severity) {
    case "info":
      return cyan("info    ");
    case "warning":
      return yellow("warning ");
    case "error":
      return red("error   ");
    case "critical":
      return red(bold("critical"));
  }
}

export function renderScan(snapshot: EnvironmentSnapshot): string {
  const lines: string[] = [bold("Agent Environment"), ""];

  lines.push(bold("Runtimes"));
  for (const r of snapshot.runtimes) {
    const status = r.installed
      ? green("installed") + (r.version ? `, version ${r.version}` : "")
      : dim("not installed");
    lines.push(`- ${r.id}: ${status}`);
  }
  lines.push("");

  lines.push(bold("Config Sources"));
  for (const r of snapshot.runtimes) {
    for (const s of r.configSources) {
      lines.push(
        `- ${tildify(s.path)} ${dim(`(${r.id}, ${s.scope}, ${s.format})`)}${s.readable ? "" : red(" [unreadable]")}`,
      );
    }
  }
  lines.push("");

  lines.push(bold("MCP Servers"));
  const anyMcp = snapshot.runtimes.some((r) => r.mcpServers.length > 0);
  if (!anyMcp) lines.push(dim("- none detected"));
  for (const r of snapshot.runtimes) {
    for (const s of r.mcpServers) {
      const envRefs = Object.entries(s.env)
        .filter(([, v]) => v.source === "env" || v.secret)
        .map(([k]) => k);
      const parts = [
        r.id,
        s.enabled ? "enabled" : dim("disabled"),
        s.command
          ? `command: ${tildify(s.command.executable)}`
          : s.url
            ? `url: ${s.url}`
            : "",
      ].filter(Boolean);
      if (envRefs.length > 0) parts.push(`env refs: ${envRefs.join(", ")}`);
      if (s.managedBy) parts.push(dim(`via plugin ${s.managedBy}`));
      lines.push(`- ${bold(s.id)}: ${parts.join(", ")}`);
    }
  }
  lines.push("");

  lines.push(bold("Instructions"));
  const anyInstr = snapshot.runtimes.some((r) => r.instructionPacks.length > 0);
  if (!anyInstr) lines.push(dim("- none detected"));
  const seenInstr = new Set<string>();
  for (const r of snapshot.runtimes) {
    for (const p of r.instructionPacks) {
      const key = p.path;
      if (seenInstr.has(key)) continue;
      seenInstr.add(key);
      lines.push(`- ${tildify(p.path)} ${dim(`(${p.type})`)}`);
    }
  }
  lines.push("");

  lines.push(bold("Skills"));
  for (const r of snapshot.runtimes) {
    if (r.skillPacks.length === 0) continue;
    lines.push(`- ${r.id}: ${r.skillPacks.length} skill(s) ${dim(`e.g. ${r.skillPacks.slice(0, 5).map((s) => s.id).join(", ")}`)}`);
  }

  const anyPlugins = snapshot.runtimes.some((r) => r.plugins.length > 0);
  if (anyPlugins) {
    lines.push("", bold("Plugins"));
    for (const r of snapshot.runtimes) {
      for (const p of r.plugins) {
        const c = p.components;
        const comps = [
          c.skills && `${c.skills} skill(s)`,
          c.agents && `${c.agents} agent(s)`,
          c.commands && `${c.commands} command(s)`,
          c.mcpServers && `${c.mcpServers} mcp`,
          c.hooks && "hooks",
        ].filter(Boolean);
        const parts = [
          r.id,
          p.version ? `v${p.version}` : "",
          p.enabled ? "enabled" : dim("disabled"),
          p.scope,
          p.exists ? "" : red("[install missing]"),
        ].filter(Boolean);
        lines.push(
          `- ${bold(p.id)}: ${parts.join(", ")}${comps.length > 0 ? dim(` (${comps.join(", ")})`) : ""}`,
        );
      }
    }
  }

  const warnings = snapshot.runtimes.flatMap((r) => r.warnings);
  if (warnings.length > 0) {
    lines.push("", yellow(bold("Warnings")));
    for (const w of warnings) lines.push(yellow(`- ${w}`));
  }
  return lines.join("\n");
}

export function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return green("No findings. Environment looks healthy.");
  }
  const order: Severity[] = ["critical", "error", "warning", "info"];
  const sorted = [...findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );
  const lines: string[] = [bold(`Doctor: ${findings.length} finding(s)`), ""];
  for (const f of sorted) {
    lines.push(
      `${severityLabel(f.severity)} ${bold(f.title)} ${dim(`[${f.category}${f.runtime ? `, ${f.runtime}` : ""}]`)}`,
    );
    lines.push(`  ${f.message}`);
    if (f.suggestedAction) lines.push(dim(`  -> ${f.suggestedAction}`));
    lines.push("");
  }
  const counts = order
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  lines.push(dim(`Summary: ${counts}`));
  return lines.join("\n");
}

export function renderPlan(plan: ChangePlan, opts: { dryRun?: boolean } = {}): string {
  const real = plan.changes.filter((c) => c.action !== "noop");
  const noop = plan.changes.filter((c) => c.action === "noop");
  const lines: string[] = [
    bold(
      `Change plan for profile "${plan.profile}"${opts.dryRun ? dim(" (dry-run)") : ""}`,
    ),
    "",
  ];
  if (real.length === 0) {
    lines.push(green("No changes needed. Environment matches the profile."));
  }
  for (const c of real) {
    const tag =
      c.action === "add"
        ? green("+ add   ")
        : c.action === "update"
          ? yellow("~ update")
          : red("- remove");
    lines.push(`${tag} ${bold(c.resourceRef)} ${dim(`(${c.runtime})`)} ${c.summary}`);
    lines.push(dim(`         file: ${tildify(c.targetPath)} risk: ${c.risk}`));
    for (const d of c.detail ?? []) lines.push(dim(`         ${d}`));
  }
  if (noop.length > 0) {
    lines.push("", dim(`${noop.length} resource(s) already match (no-op).`));
  }
  return lines.join("\n");
}

export function renderDrift(report: DriftReport): string {
  if (report.items.length === 0) {
    return green(`No drift. Environment matches profile "${report.profile}".`);
  }
  const lines: string[] = [
    bold(`Drift vs profile "${report.profile}": ${report.items.length} item(s)`),
    "",
  ];
  for (const item of report.items) {
    const tag =
      item.change === "added"
        ? green("+ added  ")
        : item.change === "removed"
          ? red("- removed")
          : yellow("~ changed");
    lines.push(`${tag} ${bold(item.resourceRef)} ${dim(`(${item.runtime}, ${item.kind})`)}`);
    lines.push(`  ${item.detail}`);
  }
  return lines.join("\n");
}
