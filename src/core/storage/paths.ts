import os from "node:os";
import path from "node:path";

/** Home dir; overridable via env for tests (AEM_HOME > HOME). */
export function homeDir(): string {
  return process.env.AEM_HOME ?? process.env.HOME ?? os.homedir();
}

/** Root of the local aem store: ~/.aem (overridable via AEM_DIR). */
export function aemDir(): string {
  return process.env.AEM_DIR ?? path.join(homeDir(), ".aem");
}

export function stateDir(): string {
  return path.join(aemDir(), "state");
}

export function profilesDir(): string {
  return path.join(aemDir(), "profiles");
}

export function snapshotsDir(): string {
  return path.join(aemDir(), "snapshots");
}

export function backupsDir(): string {
  return path.join(aemDir(), "backups");
}

export function auditDir(): string {
  return path.join(aemDir(), "audit");
}

/** Replace the home dir prefix with ~ for display/export. */
export function tildify(p: string): string {
  const home = homeDir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

/** Expand a leading ~ back into the home dir. */
export function untildify(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return path.join(homeDir(), p.slice(2));
  return p;
}
