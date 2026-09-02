import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import YAML from "yaml";
import { defaultContext, selectAdapters } from "../adapters/registry.js";
import { runDoctor } from "../core/doctor/doctor.js";
import { detectDrift } from "../core/drift/drift.js";
import type {
  DriftReport,
  EnvironmentSnapshot,
  Finding,
} from "../core/model/types.js";
import { buildSnapshot } from "../core/snapshot.js";
import {
  listProfiles,
  loadConfig,
  loadProfile,
  saveCurrentSnapshot,
  validateDesiredState,
} from "../core/storage/store.js";
import { currentVersion } from "../core/version.js";
import { DASHBOARD_HTML } from "./dashboard.js";

export interface Overview {
  version: string;
  generatedAt: string;
  snapshot: EnvironmentSnapshot;
  findings: Finding[];
  drift: DriftReport | null;
  driftProfile: string | null;
  driftSource: "project" | "active" | null;
  profiles: string[];
  activeProfile: string | null;
}

/**
 * Fresh read-only overview: scan + doctor + drift against the project
 * baseline (when present) or the active profile. Never mutates vendor
 * config; snapshots land in ~/.aem/state like any scan.
 */
export function buildOverview(project?: string): Overview {
  const adapters = selectAdapters("all");
  const ctx = defaultContext(project);
  const snapshot = buildSnapshot(adapters, ctx);
  saveCurrentSnapshot(snapshot);
  const findings = runDoctor(snapshot, adapters, ctx);

  let drift: DriftReport | null = null;
  let driftProfile: string | null = null;
  let driftSource: Overview["driftSource"] = null;
  try {
    const projectFile = path.join(ctx.project, ".aem", "desired-state.yaml");
    if (fs.existsSync(projectFile)) {
      const desired = validateDesiredState(
        YAML.parse(fs.readFileSync(projectFile, "utf8")),
      );
      drift = detectDrift(desired, snapshot, desired.metadata.name, ctx.project);
      driftProfile = desired.metadata.name;
      driftSource = "project";
    } else {
      const active = loadConfig().activeProfile;
      if (active) {
        const desired = loadProfile(active);
        drift = detectDrift(desired, snapshot, active, ctx.project);
        driftProfile = active;
        driftSource = "active";
      }
    }
  } catch {
    /* invalid/missing profile: dashboard still renders without drift */
  }

  return {
    version: currentVersion(),
    generatedAt: new Date().toISOString(),
    snapshot,
    findings,
    drift,
    driftProfile,
    driftSource,
    profiles: listProfiles(),
    activeProfile: loadConfig().activeProfile ?? null,
  };
}

/**
 * Read-only local dashboard server. GET-only, no write endpoints by design:
 * apply/import stay in the CLI where confirmation and backups live.
 */
export function createWebServer(project?: string): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "text/plain" }).end("GET only");
      return;
    }
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/" || url === "/index.html") {
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(DASHBOARD_HTML);
    } else if (url === "/api/overview") {
      try {
        res
          .writeHead(200, { "content-type": "application/json; charset=utf-8" })
          .end(JSON.stringify(buildOverview(project)));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } else {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
}
