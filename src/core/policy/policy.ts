import fs from "node:fs";
import path from "node:path";
import { Document, parse } from "yaml";
import type {
  Capabilities,
  CheckItem,
  CheckReport,
  EnvironmentSnapshot,
  ExtensionOrigin,
  HookPolicy,
  Policy,
} from "../model/types.js";
import {
  FILESYSTEM_ORDER,
  SHELL_ORDER,
  describeCapabilities,
  exceeds,
  join,
  lacks,
  narrowForAgent,
} from "../permissions/capabilities.js";

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function capabilities(value: unknown, label: string): Capabilities {
  const doc = object(value, label);
  const out: Capabilities = {};
  if (doc.shell !== undefined) {
    if (typeof doc.shell !== "string" || !SHELL_ORDER.includes(doc.shell as never)) throw new Error(`${label}.shell must be one of ${SHELL_ORDER.join(", ")}.`);
    out.shell = doc.shell as Capabilities["shell"];
  }
  if (doc.filesystem !== undefined) {
    if (typeof doc.filesystem !== "string" || !FILESYSTEM_ORDER.includes(doc.filesystem as never)) throw new Error(`${label}.filesystem must be one of ${FILESYSTEM_ORDER.join(", ")}.`);
    out.filesystem = doc.filesystem as Capabilities["filesystem"];
  }
  for (const key of ["network", "bypassPrompts"] as const) {
    if (doc[key] !== undefined) {
      if (typeof doc[key] !== "boolean") throw new Error(`${label}.${key} must be boolean.`);
      out[key] = doc[key];
    }
  }
  if (doc.mcp !== undefined) {
    if (!Array.isArray(doc.mcp) || doc.mcp.some((id) => typeof id !== "string")) throw new Error(`${label}.mcp must be a string array.`);
    out.mcp = [...doc.mcp] as string[];
  }
  if (doc.model !== undefined) {
    if (typeof doc.model !== "string") throw new Error(`${label}.model must be a string.`);
    out.model = doc.model;
  }
  return out;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`${label} must be a string array.`);
  return [...value] as string[];
}

export function policyPath(projectDir: string): string {
  return path.join(projectDir, ".aem", "policy.yaml");
}

export function validatePolicy(doc: unknown): Policy {
  const root = object(doc, "Policy");
  if (root.schemaVersion !== "aem.dev/v0") throw new Error("Policy.schemaVersion must be aem.dev/v0.");
  if (root.kind !== "Policy") throw new Error("Policy.kind must be Policy.");
  const metadata = object(root.metadata, "Policy.metadata");
  if (typeof metadata.name !== "string" || !metadata.name) throw new Error("Policy.metadata.name must be a non-empty string.");
  if (typeof metadata.createdAt !== "string") throw new Error("Policy.metadata.createdAt must be a string.");
  if (metadata.scope !== undefined && metadata.scope !== "user" && metadata.scope !== "project") throw new Error("Policy.metadata.scope must be user or project.");
  const policy: Policy = {
    schemaVersion: "aem.dev/v0",
    kind: "Policy",
    metadata: { name: metadata.name, createdAt: metadata.createdAt, ...(metadata.scope ? { scope: metadata.scope as "user" | "project" } : {}) },
    ceiling: capabilities(root.ceiling, "Policy.ceiling"),
  };
  if (root.hooks !== undefined) {
    const hooks = object(root.hooks, "Policy.hooks");
    const result: NonNullable<Policy["hooks"]> = {};
    if (hooks.events !== undefined) {
      const events = object(hooks.events, "Policy.hooks.events");
      result.events = {};
      for (const [event, value] of Object.entries(events)) {
        if (value !== "allow" && value !== "review" && value !== "deny") throw new Error(`Policy.hooks.events.${event} must be allow, review, or deny.`);
        result.events[event] = value as HookPolicy;
      }
    }
    if (hooks.allowOrigins !== undefined) result.allowOrigins = stringArray(hooks.allowOrigins, "Policy.hooks.allowOrigins") as ExtensionOrigin[];
    policy.hooks = result;
  }
  if (root.agents !== undefined) {
    const agents = object(root.agents, "Policy.agents");
    policy.agents = {};
    for (const [id, value] of Object.entries(agents)) {
      const agent = object(value, `Policy.agents.${id}`);
      const entry: NonNullable<Policy["agents"]>[string] = {};
      if (agent.ceiling !== undefined) entry.ceiling = capabilities(agent.ceiling, `Policy.agents.${id}.ceiling`);
      if (agent.requires !== undefined) entry.requires = capabilities(agent.requires, `Policy.agents.${id}.requires`);
      policy.agents[id] = entry;
    }
  }
  if (root.extensions !== undefined) {
    const extensions = object(root.extensions, "Policy.extensions");
    if (extensions.plugins !== undefined) {
      const plugins = object(extensions.plugins, "Policy.extensions.plugins");
      const entry: { allow?: string[]; deny?: string[] } = {};
      if (plugins.allow !== undefined) entry.allow = stringArray(plugins.allow, "Policy.extensions.plugins.allow");
      if (plugins.deny !== undefined) entry.deny = stringArray(plugins.deny, "Policy.extensions.plugins.deny");
      policy.extensions = { plugins: entry };
    }
  }
  return policy;
}

export function loadPolicy(file: string): Policy {
  return validatePolicy(parse(fs.readFileSync(file, "utf8")));
}

export function scaffoldPolicy(snapshot: EnvironmentSnapshot, name: string, scope: "user" | "project"): Policy {
  let ceiling: Capabilities = {};
  const events = new Set<string>();
  const origins = new Set<ExtensionOrigin>(["user", "project"]);
  const plugins = new Set<string>();
  for (const runtime of snapshot.runtimes) {
    if (runtime.installed && runtime.permissions) ceiling = join(ceiling, runtime.permissions.effective);
    for (const hook of runtime.hooks) { events.add(hook.event); origins.add(hook.origin); }
    for (const plugin of runtime.plugins) if (plugin.enabled) plugins.add(plugin.id);
  }
  delete ceiling.model;
  delete ceiling.mcp;
  ceiling.bypassPrompts = false;
  return {
    schemaVersion: "aem.dev/v0", kind: "Policy",
    metadata: { name, createdAt: new Date().toISOString(), scope }, ceiling,
    hooks: { events: Object.fromEntries([...events].sort().map((event) => [event, event === "PermissionRequest" ? "deny" : "review"])), allowOrigins: [...origins].sort() as ExtensionOrigin[] },
    agents: { "*": { ceiling: { bypassPrompts: false } } },
    extensions: { plugins: { allow: [...plugins].sort() } },
  };
}

/** true when any installed runtime currently bypasses prompts (scaffold comment input) */
export function bypassCurrentlyOn(snapshot: EnvironmentSnapshot): boolean {
  return snapshot.runtimes.some(
    (r) => r.installed && r.permissions?.effective.bypassPrompts === true,
  );
}

export function serializePolicy(
  policy: Policy,
  opts: { bypassCurrentlyOn?: boolean } = {},
): string {
  const document = new Document(policy);
  document.commentBefore =
    " vendor-neutral permission ceiling; aem check verifies local agents against it; see _docs/05-permission-layer.md";
  if (opts.bypassCurrentlyOn && policy.ceiling.bypassPrompts === false) {
    const bypass = document.getIn(["ceiling", "bypassPrompts"], true) as
      | { comment?: string }
      | undefined;
    if (bypass) bypass.comment = " currently TRUE locally — aem check will flag this";
  }
  return document.toString();
}

function item(runtime: string, subject: CheckItem["subject"], severity: CheckItem["severity"], rule: string, message: string, fidelity?: CheckItem["fidelity"]): CheckItem {
  return { runtime, subject, severity, rule, message, ...(fidelity ? { fidelity } : {}) };
}

export function runCheck(policy: Policy, snapshot: EnvironmentSnapshot, policyName: string): CheckReport {
  const items: CheckItem[] = [];
  for (const runtime of snapshot.runtimes) {
    if (!runtime.installed || !runtime.permissions) continue;
    const effective = runtime.permissions.effective;
    for (const excess of exceeds(effective, policy.ceiling)) {
      const fidelity = runtime.permissions.fidelity[excess.capability];
      items.push(item(runtime.id, "main", fidelity === "lossy" ? "warning" : "error", `ceiling.${excess.capability}`, `Main capability ${excess.capability}=${excess.actual} exceeds policy ceiling ${excess.limit}.`, fidelity));
    }
    for (const agent of runtime.agents) {
      const agentPolicy = policy.agents?.[agent.id] ?? policy.agents?.["*"];
      if (!agentPolicy) continue;
      const effectiveAgent = narrowForAgent(effective, agent);
      for (const excess of exceeds(effectiveAgent, agentPolicy.ceiling ?? {})) {
        items.push(item(runtime.id, `agent:${agent.id}`, "error", `agents.${policy.agents?.[agent.id] ? agent.id : "*"}.ceiling.${excess.capability}`, `Agent ${agent.id} capability ${excess.capability}=${excess.actual} exceeds ceiling ${excess.limit}.`));
      }
      if (agentPolicy.requires) for (const shortfall of lacks(effectiveAgent, agentPolicy.requires)) {
        items.push(item(runtime.id, `agent:${agent.id}`, "warning", `agents.${agent.id}.requires.${shortfall.capability}`, `Agent ${agent.id} requires ${shortfall.capability}=${shortfall.required} but has ${shortfall.actual}.`));
      }
    }
    for (const hook of runtime.hooks) {
      const action = policy.hooks?.events?.[hook.event];
      const message = `Hook from ${hook.origin} runs ${hook.command}.`;
      if (action === "deny") items.push(item(runtime.id, `hook:${hook.event}`, "error", `hooks.events.${hook.event}`, message));
      else if (action === "review") items.push(item(runtime.id, `hook:${hook.event}`, "info", `hooks.events.${hook.event}`, message));
      if (policy.hooks?.allowOrigins && !policy.hooks.allowOrigins.includes(hook.origin)) items.push(item(runtime.id, `hook:${hook.event}`, "warning", "hooks.allowOrigins", message));
    }
    const pluginPolicy = policy.extensions?.plugins;
    if (pluginPolicy) for (const plugin of runtime.plugins) {
      if (!plugin.enabled) continue;
      if (pluginPolicy.deny?.includes(plugin.id)) items.push(item(runtime.id, `plugin:${plugin.id}`, "error", "extensions.plugins.deny", `Enabled plugin ${plugin.id} is denied by policy.`));
      else if (pluginPolicy.allow && !pluginPolicy.allow.includes(plugin.id)) items.push(item(runtime.id, `plugin:${plugin.id}`, "warning", "extensions.plugins.allow", `Enabled plugin ${plugin.id} is not in the policy allow list.`));
    }
  }
  return { schemaVersion: "aem.dev/v0", kind: "CheckReport", policy: policyName, generatedAt: new Date().toISOString(), items };
}

export function hasViolations(report: CheckReport): boolean {
  return report.items.some((entry) => entry.severity === "error" || entry.severity === "critical");
}

export { describeCapabilities };
