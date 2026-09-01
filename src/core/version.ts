import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** GitHub repository that hosts aem releases. */
export const RELEASE_REPO = "CodeMath/agent-enviorment-manager";

/** Single source of truth: version from the installed package.json. */
export function currentVersion(): string {
  // dist/core/version.js -> ../../package.json (same shape in src for tests)
  const pkgPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "package.json",
  );
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version: string;
  };
  return pkg.version;
}

/** Strip a leading v/V from a tag: v0.1.0 -> 0.1.0 */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

/**
 * Compare two x.y.z versions numerically.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Non-numeric segments (prereleases) are compared as lower than release.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore = "", aPre] = normalizeTag(a).split("-", 2);
  const [bCore = "", bPre] = normalizeTag(b).split("-", 2);
  const as = aCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bs = bCore.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const d = (as[i] ?? 0) - (bs[i] ?? 0);
    if (d !== 0) return d;
  }
  if (aPre && !bPre) return -1; // 1.0.0-beta < 1.0.0
  if (!aPre && bPre) return 1;
  if (aPre && bPre) return aPre.localeCompare(bPre);
  return 0;
}
