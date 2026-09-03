import fs from "node:fs";
import path from "node:path";
import { snapshotToDesiredState } from "../../core/desired.js";
import {
  describeCapabilities,
  policyPath,
  bypassCurrentlyOn,
  scaffoldPolicy,
  serializePolicy,
} from "../../core/policy/policy.js";
import { serializeDesiredState } from "../../core/storage/store.js";
import { bold, dim, green } from "../../output/text.js";
import { failWith, scanNow } from "../common.js";

export function projectProfilePath(projectDir: string): string {
  return path.join(projectDir, ".aem", "desired-state.yaml");
}

/**
 * Create <project>/.aem/desired-state.yaml from the current scan,
 * containing only project-scope resources (project MCP config,
 * instructions, skills) with ${PROJECT_ROOT}-relative paths.
 */
export function runInit(opts: { vendor: string; force?: boolean }): void {
  const projectDir = process.cwd();
  const target = projectProfilePath(projectDir);
  if (fs.existsSync(target) && !opts.force) {
    failWith(
      `${target} already exists.`,
      "Use --force to regenerate it from the current environment.",
    );
  }

  const { ctx, snapshot } = scanNow(opts.vendor, projectDir);
  const desired = snapshotToDesiredState(snapshot, path.basename(projectDir), {
    description: "Project-scope agent environment baseline",
    projectDir: ctx.project,
    scope: "project",
  });

  const empty =
    desired.mcpServers.length === 0 &&
    desired.instructions.length === 0 &&
    desired.skills.length === 0;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeDesiredState(desired));
  process.stdout.write(
    green(`Initialized project profile: `) + bold(target) + "\n",
  );
  process.stdout.write(
    dim(
      `${desired.mcpServers.length} MCP server(s), ${desired.instructions.length} instruction(s), ${desired.skills.length} skill(s) captured.\n`,
    ),
  );
  const policyTarget = policyPath(projectDir);
  if (fs.existsSync(policyTarget) && !opts.force) {
    process.stdout.write(dim(`Preserved existing policy: ${policyTarget}\n`));
  } else {
    const policy = scaffoldPolicy(snapshot, path.basename(projectDir), "project");
    fs.writeFileSync(
      policyTarget,
      serializePolicy(policy, { bypassCurrentlyOn: bypassCurrentlyOn(snapshot) }),
    );
    const hooks = Object.keys(policy.hooks?.events ?? {}).length;
    const plugins = policy.extensions?.plugins?.allow?.length ?? 0;
    process.stdout.write(
      dim(
        `Policy ceiling: ${describeCapabilities(policy.ceiling)}; ${hooks} hook event(s), ${plugins} plugin(s) captured. Run \`aem check\`.\n`,
      ),
    );
  }
  if (empty) {
    process.stdout.write(
      dim(
        "No project-scope resources detected yet — add project MCP config (e.g. .mcp.json) or AGENTS.md and re-run with --force.\n",
      ),
    );
  }
  process.stdout.write(
    dim(
      "Commit .aem/desired-state.yaml to share this baseline; `aem drift`/`aem doctor` pick it up automatically in this directory.\n",
    ),
  );
}
