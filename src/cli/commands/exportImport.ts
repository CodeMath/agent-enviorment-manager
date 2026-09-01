import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { snapshotToDesiredState } from "../../core/desired.js";
import { containsSecretLooking } from "../../core/redaction/redact.js";
import { appendAudit } from "../../core/storage/audit.js";
import { untildify } from "../../core/storage/paths.js";
import {
  profilePath,
  saveProfile,
  serializeDesiredState,
  validateDesiredState,
} from "../../core/storage/store.js";
import { failWith, scanNow } from "../common.js";

export function runExport(opts: {
  profile: string;
  out?: string;
  vendor: string;
  force?: boolean;
}): void {
  const { ctx, snapshot } = scanNow(opts.vendor);
  const desired = snapshotToDesiredState(snapshot, opts.profile, {
    description: "Exported from local environment scan",
    projectDir: ctx.project,
  });

  try {
    if (opts.out) {
      const out = untildify(opts.out);
      const yaml = serializeDesiredState(desired);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, yaml);
      process.stdout.write(`Exported profile "${opts.profile}" to ${out}\n`);
    } else {
      const p = saveProfile(desired, { force: opts.force });
      process.stdout.write(`Exported profile "${opts.profile}" to ${p}\n`);
    }
  } catch (err) {
    failWith(err instanceof Error ? err.message : String(err));
  }
  appendAudit({
    at: new Date().toISOString(),
    command: `export --profile ${opts.profile}`,
    profile: opts.profile,
    result: "ok",
  });
}

export function runImport(opts: {
  file: string;
  name?: string;
  force?: boolean;
}): void {
  const file = untildify(opts.file);
  if (!fs.existsSync(file)) {
    failWith(`File not found: ${file}`);
  }
  const text = fs.readFileSync(file, "utf8");
  if (containsSecretLooking(text)) {
    failWith(
      `Profile file ${file} contains a secret-looking value.`,
      "Remove the secret from the file (use env references) and re-import.",
    );
  }
  let desired;
  try {
    desired = validateDesiredState(YAML.parse(text));
  } catch (err) {
    failWith(
      `Cannot import ${file}: ${err instanceof Error ? err.message : String(err)}`,
      "Check the profile schemaVersion and structure against `aem export` output.",
    );
  }
  if (opts.name) desired.metadata.name = opts.name;

  try {
    const p = saveProfile(desired, { force: opts.force });
    process.stdout.write(`Imported profile "${desired.metadata.name}" -> ${p}\n`);
  } catch (err) {
    failWith(
      err instanceof Error ? err.message : String(err),
      `Use --force to overwrite, or --name to import under a different name.`,
    );
  }
  appendAudit({
    at: new Date().toISOString(),
    command: `import ${opts.file}`,
    profile: desired.metadata.name,
    result: "ok",
  });
}
