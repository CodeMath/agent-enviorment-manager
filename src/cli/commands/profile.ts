import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { tildify } from "../../core/storage/paths.js";
import {
  deleteProfile,
  listProfiles,
  loadConfig,
  loadProfile,
  profilePath,
  saveConfig,
  serializeDesiredState,
  validateDesiredState,
} from "../../core/storage/store.js";
import { bold, dim, green } from "../../output/text.js";
import { failWith } from "../common.js";

export function runProfileList(): void {
  const profiles = listProfiles();
  const active = loadConfig().activeProfile;
  if (profiles.length === 0) {
    process.stdout.write(
      "No profiles yet. Create one with `aem export --profile <name>`.\n",
    );
    return;
  }
  for (const name of profiles) {
    const mark = name === active ? green("* ") : "  ";
    process.stdout.write(`${mark}${name} ${dim(tildify(profilePath(name)))}\n`);
  }
}

export function runProfileShow(name: string): void {
  try {
    const desired = loadProfile(name);
    process.stdout.write(serializeDesiredState(desired));
  } catch (err) {
    failWith(err instanceof Error ? err.message : String(err));
  }
}

export function runProfileUse(name: string): void {
  try {
    loadProfile(name); // validates existence + schema
  } catch (err) {
    failWith(err instanceof Error ? err.message : String(err));
  }
  saveConfig({ ...loadConfig(), activeProfile: name });
  process.stdout.write(
    `Active profile set to ${bold(name)}. Commands without --profile will use it.\n`,
  );
}

export function runProfileDelete(name: string): void {
  try {
    deleteProfile(name);
  } catch (err) {
    failWith(err instanceof Error ? err.message : String(err));
  }
  const config = loadConfig();
  if (config.activeProfile === name) {
    delete config.activeProfile;
    saveConfig(config);
  }
  process.stdout.write(`Deleted profile "${name}".\n`);
}

/**
 * Resolve the desired state to check against, in precedence order:
 * 1. explicit --profile <name> (user profile store)
 * 2. <cwd>/.aem/desired-state.yaml (project profile, when present)
 * 3. the active user profile (`aem profile use`)
 */
export function resolveDesired(flag?: string): {
  name: string;
  desired: import("../../core/model/types.js").DesiredState;
  source: "flag" | "project" | "active";
} {
  if (flag) {
    try {
      return { name: flag, desired: loadProfile(flag), source: "flag" };
    } catch (err) {
      failWith(
        err instanceof Error ? err.message : String(err),
        "Run `aem profile list` to see available profiles.",
      );
    }
  }

  const projectFile = path.join(process.cwd(), ".aem", "desired-state.yaml");
  if (fs.existsSync(projectFile)) {
    try {
      const desired = validateDesiredState(
        YAML.parse(fs.readFileSync(projectFile, "utf8")),
      );
      return { name: desired.metadata.name, desired, source: "project" };
    } catch (err) {
      failWith(
        `Invalid project profile ${projectFile}: ${err instanceof Error ? err.message : String(err)}`,
        "Fix the file or re-generate it with `aem init --force`.",
      );
    }
  }

  const active = loadConfig().activeProfile;
  if (!active) {
    failWith(
      "No profile specified, no project .aem/desired-state.yaml, and no active profile set.",
      "Pass --profile <name>, run `aem init` in a project, or `aem profile use <name>`.",
    );
  }
  try {
    return { name: active, desired: loadProfile(active), source: "active" };
  } catch (err) {
    failWith(err instanceof Error ? err.message : String(err));
  }
}
