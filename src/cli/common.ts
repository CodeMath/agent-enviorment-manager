import readline from "node:readline";
import { defaultContext, selectAdapters } from "../adapters/registry.js";
import type { AdapterContext, AgentRuntimeAdapter } from "../adapters/types.js";
import type { EnvironmentSnapshot } from "../core/model/types.js";
import { buildSnapshot } from "../core/snapshot.js";
import { saveCurrentSnapshot } from "../core/storage/store.js";

export interface ScanSetup {
  adapters: AgentRuntimeAdapter[];
  ctx: AdapterContext;
  snapshot: EnvironmentSnapshot;
}

/** Scan with the selected adapters and persist the snapshot. */
export function scanNow(vendor: string, project?: string): ScanSetup {
  const adapters = selectAdapters(vendor);
  const ctx = defaultContext(project);
  const snapshot = buildSnapshot(adapters, ctx);
  saveCurrentSnapshot(snapshot);
  return { adapters, ctx, snapshot };
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) =>
    rl.question(`${question} [y/N] `, resolve),
  );
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export function failWith(reason: string, next?: string): never {
  process.stderr.write(`Error: ${reason}\n`);
  if (next) process.stderr.write(`Next: ${next}\n`);
  process.exit(1);
}
