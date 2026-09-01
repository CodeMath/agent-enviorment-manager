import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  ConfigSource,
  EnvVarRef,
  InstructionPack,
  McpServer,
  SkillPack,
} from "../core/model/types.js";
import { isSecret, redactDeep } from "../core/redaction/redact.js";
import type { AdapterContext } from "./types.js";

export function detectVersion(
  ctx: AdapterContext,
  binary: string,
  args: string[] = ["--version"],
): { installed: boolean; version?: string } {
  if (!ctx.allowExec) {
    return { installed: false };
  }
  const res = spawnSync(binary, args, {
    encoding: "utf8",
    timeout: 4000,
    env: process.env,
  });
  if (res.error || res.status !== 0) return { installed: false };
  const out = (res.stdout || "").trim();
  const match = out.match(/(\d+\.\d+[\.\d]*)/);
  return { installed: true, version: match?.[1] ?? out.slice(0, 40) };
}

export function configSource(
  id: string,
  scope: "user" | "project",
  filePath: string,
  format: ConfigSource["format"],
): ConfigSource {
  const exists = fs.existsSync(filePath);
  let readable = false;
  if (exists) {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }
  }
  return { id, scope, path: filePath, format, exists, readable };
}

export function instructionPack(
  id: string,
  type: "user" | "project",
  filePath: string,
): InstructionPack {
  const exists = fs.existsSync(filePath);
  const pack: InstructionPack = { id, type, path: filePath, exists };
  if (exists) {
    try {
      const buf = fs.readFileSync(filePath);
      pack.sha256 = createHash("sha256").update(buf).digest("hex");
      pack.sizeBytes = buf.length;
    } catch {
      /* unreadable file: keep exists=true without hash */
    }
  }
  return pack;
}

export function skillPacksFromDir(
  dir: string,
  type: "user" | "project",
): SkillPack[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ id: e.name, type, path: path.join(dir, e.name) }));
  } catch {
    return [];
  }
}

/**
 * Normalize a vendor MCP env block into secret-safe EnvVarRefs.
 * `${VAR}` style values are treated as env references.
 */
export function normalizeEnv(
  env: Record<string, unknown> | undefined,
  processEnv: Record<string, string | undefined>,
): Record<string, EnvVarRef> {
  const out: Record<string, EnvVarRef> = {};
  if (!env) return out;
  for (const [name, rawValue] of Object.entries(env)) {
    const value = typeof rawValue === "string" ? rawValue : String(rawValue);
    const envRefMatch = value.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    if (envRefMatch) {
      const refName = envRefMatch[1]!;
      out[name] = {
        source: "env",
        secret: isSecret(name, "placeholder-value"),
        present: processEnv[refName] !== undefined,
      };
    } else if (isSecret(name, value)) {
      out[name] = { source: "inline", secret: true };
    } else {
      out[name] = { source: "inline", secret: false, value };
    }
  }
  return out;
}

const KNOWN_MCP_FIELDS = new Set([
  "command",
  "args",
  "env",
  "enabled",
  "url",
  "type",
  "transport",
  "timeout",
  "startup_timeout_sec",
]);

/** Preserve unknown vendor fields (deep-redacted). */
export function unknownFields(
  block: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block)) {
    if (!KNOWN_MCP_FIELDS.has(k)) raw[k] = v;
  }
  if (Object.keys(raw).length === 0) return undefined;
  return redactDeep(raw);
}

export function normalizeMcpBlock(
  id: string,
  block: Record<string, unknown>,
  sourcePath: string,
  processEnv: Record<string, string | undefined>,
): McpServer {
  const command = typeof block.command === "string" ? block.command : undefined;
  const args = Array.isArray(block.args) ? block.args.map(String) : [];
  const url = typeof block.url === "string" ? block.url : undefined;
  const typeField =
    typeof block.type === "string"
      ? block.type
      : typeof block.transport === "string"
        ? block.transport
        : undefined;

  let transport: McpServer["transport"] = "unknown";
  if (typeField === "stdio" || typeField === "http" || typeField === "sse") {
    transport = typeField;
  } else if (command) {
    transport = "stdio";
  } else if (url) {
    transport = "http";
  }

  return {
    id,
    enabled: block.enabled !== false,
    transport,
    command: command ? { executable: command, args } : undefined,
    url,
    env: normalizeEnv(
      block.env as Record<string, unknown> | undefined,
      processEnv,
    ),
    raw: unknownFields(block),
    sourcePath,
  };
}
