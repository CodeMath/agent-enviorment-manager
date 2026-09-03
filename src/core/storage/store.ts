import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { DesiredState, EnvironmentSnapshot } from "../model/types.js";
import { SCHEMA_VERSION } from "../model/types.js";
import { containsSecretLooking } from "../redaction/redact.js";
import {
  aemDir,
  profilesDir,
  snapshotsDir,
  stateDir,
} from "./paths.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function initStore(): void {
  for (const d of [aemDir(), stateDir(), profilesDir(), snapshotsDir()]) {
    ensureDir(d);
  }
}

/* ------------------------- snapshots / state ------------------------- */

export function saveCurrentSnapshot(snapshot: EnvironmentSnapshot): void {
  initStore();
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(path.join(stateDir(), "current.json"), json);
  fs.writeFileSync(path.join(stateDir(), "last-scan.json"), json);
  const stamp = snapshot.generatedAt.replace(/[:]/g, "-");
  fs.writeFileSync(path.join(snapshotsDir(), `${stamp}.json`), json);
}

export function loadCurrentSnapshot(): EnvironmentSnapshot | undefined {
  const p = path.join(stateDir(), "current.json");
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8")) as EnvironmentSnapshot;
}

/* ------------------------- profiles ------------------------- */

export interface ProfileValidationError extends Error {
  code: "schema" | "secret" | "conflict" | "not_found";
}

function fail(code: ProfileValidationError["code"], message: string): never {
  const err = new Error(message) as ProfileValidationError;
  err.code = code;
  throw err;
}

export function validateDesiredState(doc: unknown): DesiredState {
  if (doc === null || typeof doc !== "object") {
    fail("schema", "Profile is not a mapping/object.");
  }
  const d = doc as Partial<DesiredState>;
  if (d.schemaVersion !== SCHEMA_VERSION) {
    fail(
      "schema",
      `Unsupported schemaVersion "${String(d.schemaVersion)}" (expected ${SCHEMA_VERSION}).`,
    );
  }
  if (d.kind !== "DesiredState") {
    fail("schema", `Unsupported kind "${String(d.kind)}" (expected DesiredState).`);
  }
  if (!d.metadata?.name) {
    fail("schema", "Profile is missing metadata.name.");
  }
  if (!Array.isArray(d.mcpServers)) {
    fail("schema", "Profile is missing mcpServers list.");
  }
  for (const s of d.mcpServers) {
    if (!s.id) fail("schema", "mcpServers entry is missing id.");
    if (!Array.isArray(s.allowedRuntimes)) {
      fail("schema", `mcpServers.${s.id} is missing allowedRuntimes.`);
    }
  }
  // plugins is optional in the profile file; absent means "none declared"
  if (d.plugins === undefined) d.plugins = [];
  if (!Array.isArray(d.plugins)) fail("schema", "plugins must be a list.");
  for (const p of d.plugins) {
    if (!p.id) fail("schema", "plugins entry is missing id.");
    if (!Array.isArray(p.applyTo)) fail("schema", `plugins.${p.id} is missing applyTo.`);
  }
  return d as DesiredState;
}

export function profilePath(name: string): string {
  return path.join(profilesDir(), `${name}.yaml`);
}

export function listProfiles(): string[] {
  if (!fs.existsSync(profilesDir())) return [];
  return fs
    .readdirSync(profilesDir())
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => f.replace(/\.ya?ml$/, ""))
    .sort();
}

export function loadProfile(name: string): DesiredState {
  const p = profilePath(name);
  if (!fs.existsSync(p)) {
    fail("not_found", `Profile "${name}" not found in ${profilesDir()}.`);
  }
  return validateDesiredState(YAML.parse(fs.readFileSync(p, "utf8")));
}

export function saveProfile(
  desired: DesiredState,
  opts: { force?: boolean } = {},
): string {
  initStore();
  const name = desired.metadata.name;
  const p = profilePath(name);
  if (fs.existsSync(p) && !opts.force) {
    fail("conflict", `Profile "${name}" already exists. Use --force to overwrite.`);
  }
  const yaml = serializeDesiredState(desired);
  fs.writeFileSync(p, yaml);
  return p;
}

/** Serialize with a final export guard: refuse to emit secret-looking values. */
export function serializeDesiredState(desired: DesiredState): string {
  const yaml = YAML.stringify(desired, { lineWidth: 120 });
  if (containsSecretLooking(yaml)) {
    fail(
      "secret",
      "Export guard: serialized profile contains a secret-looking value. Refusing to write.",
    );
  }
  return yaml;
}

export function deleteProfile(name: string): void {
  const p = profilePath(name);
  if (!fs.existsSync(p)) {
    fail("not_found", `Profile "${name}" not found.`);
  }
  fs.rmSync(p);
}

/* ------------------------- active profile config ------------------------- */

interface AemConfig {
  activeProfile?: string;
}

function configPath(): string {
  return path.join(aemDir(), "config.yaml");
}

export function loadConfig(): AemConfig {
  const p = configPath();
  if (!fs.existsSync(p)) return {};
  return (YAML.parse(fs.readFileSync(p, "utf8")) as AemConfig) ?? {};
}

export function saveConfig(config: AemConfig): void {
  initStore();
  fs.writeFileSync(configPath(), YAML.stringify(config));
}
