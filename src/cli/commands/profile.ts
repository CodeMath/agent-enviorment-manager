import { tildify } from "../../core/storage/paths.js";
import {
  deleteProfile,
  listProfiles,
  loadConfig,
  loadProfile,
  profilePath,
  saveConfig,
  serializeDesiredState,
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

/** Resolve --profile flag or fall back to the active profile. */
export function resolveProfileName(flag?: string): string {
  const name = flag ?? loadConfig().activeProfile;
  if (!name) {
    failWith(
      "No profile specified and no active profile set.",
      "Pass --profile <name> or set one with `aem profile use <name>`.",
    );
  }
  return name;
}
