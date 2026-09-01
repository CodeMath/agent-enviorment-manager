import { createHash } from "node:crypto";
import os from "node:os";
import type { AdapterContext, AgentRuntimeAdapter } from "../adapters/types.js";
import type { EnvironmentSnapshot, RuntimeState } from "./model/types.js";
import { SCHEMA_VERSION } from "./model/types.js";

/**
 * Run adapters and build the canonical EnvironmentSnapshot.
 * One adapter failing never blocks the others; failures are recorded
 * as warnings on a degraded runtime entry.
 */
export function buildSnapshot(
  adapters: AgentRuntimeAdapter[],
  ctx: AdapterContext,
): EnvironmentSnapshot {
  const runtimes: RuntimeState[] = adapters.map((adapter) => {
    try {
      return adapter.read(ctx);
    } catch (err) {
      return {
        id: adapter.id,
        name: adapter.displayName,
        installed: false,
        adapterVersion: adapter.adapterVersion,
        configSources: [],
        mcpServers: [],
        instructionPacks: [],
        skillPacks: [],
        warnings: [
          `Adapter failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "EnvironmentSnapshot",
    generatedAt: new Date().toISOString(),
    host: {
      os: process.platform,
      arch: process.arch,
      hostnameHash:
        "sha256:" + createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16),
    },
    runtimes,
    findings: [],
  };
}
