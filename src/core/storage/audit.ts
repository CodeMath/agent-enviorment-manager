import fs from "node:fs";
import path from "node:path";
import { auditDir } from "./paths.js";

export interface AuditEvent {
  at: string;
  command: string;
  profile?: string;
  changedFiles?: string[];
  adapterVersions?: Record<string, string>;
  result: "ok" | "error" | "partial";
  detail?: string;
}

/** Append-only local audit log (~/.aem/audit/events.jsonl). */
export function appendAudit(event: AuditEvent): void {
  fs.mkdirSync(auditDir(), { recursive: true });
  fs.appendFileSync(
    path.join(auditDir(), "events.jsonl"),
    JSON.stringify(event) + "\n",
  );
}
