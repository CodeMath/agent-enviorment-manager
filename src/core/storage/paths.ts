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

/**
 * Make a string machine-portable: replace every occurrence of the absolute
 * home dir with ~, including occurrences embedded inside larger values
 * (e.g. JSON strings in env vars). Boundary-guarded so /Users/jadenx is
 * not mangled by home /Users/jaden.
 */
export function portabilize(value: string): string {
  const home = homeDir();
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(
    new RegExp(`${escaped}(?=[/\\\\"'\\s:,}\\]]|$)`, "g"),
    "~",
  );
}

/**
 * Inverse of portabilize for the current machine: expand ~ back into the
 * home dir, both as a whole value and embedded (~/ preceded by a boundary).
 */
export function materialize(value: string): string {
  const home = homeDir();
  if (value === "~") return home;
  return value.replace(/(^|["'\s:=,{[(])~(?=\/)/g, (_m, pre: string) => pre + home);
}

function mapStringsDeep(input: unknown, fn: (s: string) => string): unknown {
  if (typeof input === "string") return fn(input);
  if (Array.isArray(input)) return input.map((v) => mapStringsDeep(v, fn));
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = mapStringsDeep(v, fn);
    }
    return out;
  }
  return input;
}

export function portabilizeDeep<T>(input: T): T {
  return mapStringsDeep(input, portabilize) as T;
}

export function materializeDeep<T>(input: T): T {
  return mapStringsDeep(input, materialize) as T;
}
