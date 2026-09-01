import fs from "node:fs";
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

/** Marker used to variable-ize the project root in portable profiles. */
export const PROJECT_ROOT_MARKER = "${PROJECT_ROOT}";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BOUNDARY = `(?=[/\\\\"'\\s:,}\\]]|$)`;

/**
 * A path plus its symlink-resolved form (macOS: /var/folders vs
 * /private/var/folders). Configs may contain either spelling.
 */
function pathVariants(p: string): string[] {
  const variants = new Set([p]);
  try {
    const real = fs.realpathSync(p);
    variants.add(real);
  } catch {
    /* non-existent path: raw form only */
  }
  if (process.platform === "darwin") {
    // macOS firmlinks: /tmp, /var, /etc are aliases of /private/{tmp,var,etc}
    for (const v of [...variants]) {
      const stripped = v.match(/^\/private(\/(?:tmp|var|etc)(?:\/.*)?)$/);
      if (stripped) variants.add(stripped[1]!);
      else if (/^\/(?:tmp|var|etc)(?:\/|$)/.test(v)) variants.add("/private" + v);
    }
  }
  return [...variants];
}

/**
 * Relative path of filePath inside dir (symlink-tolerant on both sides),
 * or undefined when filePath is not under dir.
 */
export function relativeToDir(filePath: string, dir: string): string | undefined {
  for (const d of pathVariants(dir)) {
    for (const f of pathVariants(filePath)) {
      const rel = path.relative(d, f);
      if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
    }
  }
  return undefined;
}

/** true when filePath lives inside dir (symlink-tolerant on both sides). */
export function isUnderDir(filePath: string, dir: string): boolean {
  return relativeToDir(filePath, dir) !== undefined;
}

/**
 * Make a string machine-portable: replace every occurrence of the absolute
 * home dir with ~ (and, when given, the project root with ${PROJECT_ROOT}),
 * including occurrences embedded inside larger values (e.g. JSON strings in
 * env vars). Boundary-guarded so /Users/jadenx is not mangled by home
 * /Users/jaden. Project root wins over home when it is nested inside it.
 */
function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

export function portabilize(value: string, projectDir?: string): string {
  let out = value;
  const homeVariants = pathVariants(homeDir());
  if (projectDir) {
    const projectPatterns = new Set(pathVariants(projectDir));
    // When the project lives under home, also cover every home *spelling*
    // (macOS /var/folders vs /private/var/folders symlinks and the like).
    const realProject = realpathOr(projectDir);
    for (const home of homeVariants) {
      const realHome = realpathOr(home);
      if (realProject.startsWith(realHome + path.sep)) {
        projectPatterns.add(home + realProject.slice(realHome.length));
      }
    }
    for (const dir of projectPatterns) {
      out = out.replace(
        new RegExp(escapeRegExp(dir) + BOUNDARY, "g"),
        PROJECT_ROOT_MARKER.replace(/\$/g, "$$$$"),
      );
    }
  }
  for (const home of homeVariants) {
    out = out.replace(new RegExp(escapeRegExp(home) + BOUNDARY, "g"), "~");
  }
  return out;
}

/**
 * Inverse of portabilize for the current machine: expand ~ and
 * ${PROJECT_ROOT} back into absolute paths. Literal `./` values are left
 * untouched — they may be genuinely relative in vendor configs.
 */
export function materialize(value: string, projectDir?: string): string {
  const home = homeDir();
  let out = value;
  if (projectDir) {
    out = out.split(PROJECT_ROOT_MARKER).join(projectDir);
  }
  if (out === "~") return home;
  return out.replace(/(^|["'\s:=,{[(])~(?=\/)/g, (_m, pre: string) => pre + home);
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

export function portabilizeDeep<T>(input: T, projectDir?: string): T {
  return mapStringsDeep(input, (s) => portabilize(s, projectDir)) as T;
}

export function materializeDeep<T>(input: T, projectDir?: string): T {
  return mapStringsDeep(input, (s) => materialize(s, projectDir)) as T;
}
