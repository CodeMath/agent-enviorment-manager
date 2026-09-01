import fs from "node:fs";
import path from "node:path";
import { backupsDir, homeDir } from "./paths.js";

/**
 * Copy files into ~/.aem/backups/<timestamp>/<vendor>/<relative-config-path>
 * before any vendor config is modified. Returns the backup root dir.
 */
export function backupFiles(vendor: string, files: string[]): string {
  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  const root = path.join(backupsDir(), stamp, vendor);
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const rel = file.startsWith(homeDir() + path.sep)
      ? file.slice(homeDir().length + 1)
      : file.replace(/^\//, "");
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }
  return root;
}
