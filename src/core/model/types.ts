/**
 * Canonical data model v0 (aem.dev/v0)
 *
 * Every vendor config is normalized into these types. Vendor adapters
 * translate between vendor-native files and this model. See
 * _docs/03-mvp-functional-spec.md section 6.
 */

export const SCHEMA_VERSION = "aem.dev/v0";

export type Severity = "info" | "warning" | "error" | "critical";

export type FindingCategory =
  | "missing_env"
  | "secret_inline"
  | "broken_path"
  | "duplicate_mcp"
  | "dangerous_command"
  | "unknown_config"
  | "stale_profile"
  | "drift_detected"
  | "unsupported_version"
  | "permission_risk"
  | "hook_risk"
  | "policy_violation";

export interface Finding {
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  message: string;
  runtime?: string;
  resourceRef?: string;
  suggestedAction?: string;
}

/** Secrets are never stored by value; only their reference/shape is kept. */
export interface EnvVarRef {
  /** where the value comes from */
  source: "env" | "inline" | "unknown";
  /** whether a secret-looking value was present (value itself is dropped) */
  secret: boolean;
  /** for source=env: whether the variable exists in the current shell env */
  present?: boolean;
  /** only kept for non-secret inline values */
  value?: string;
}

export interface ConfigSource {
  id: string;
  scope: "user" | "project";
  path: string;
  format: "toml" | "json" | "markdown" | "directory" | "unknown";
  exists: boolean;
  readable: boolean;
}

export interface McpCommand {
  executable: string;
  args: string[];
}

export interface McpServer {
  id: string;
  enabled: boolean;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: McpCommand;
  url?: string;
  env: Record<string, EnvVarRef>;
  /** unknown vendor fields, preserved (secret-redacted) */
  raw?: Record<string, unknown>;
  /** vendor config file this server was read from */
  sourcePath: string;
  /**
   * Set when the server is bundled by a plugin (PluginPack.id). Such servers
   * are observed (scan/doctor) but never exported, planned, or drift-compared
   * individually: the plugin entry is the unit of management.
   */
  managedBy?: string;
}

export interface InstructionPack {
  id: string;
  type: "user" | "project";
  path: string;
  exists: boolean;
  sha256?: string;
  sizeBytes?: number;
}

export interface SkillPack {
  id: string;
  type: "user" | "project";
  path: string;
}

/** Component counts discovered inside a plugin install directory. */
export interface PluginComponents {
  skills: number;
  agents: number;
  commands: number;
  hooks: boolean;
  mcpServers: number;
}

/**
 * A vendor plugin/extension registered through the vendor's own plugin
 * system (e.g. Claude Code `~/.claude/plugins`). Plugins bundle skills,
 * agents, commands, hooks and MCP servers and are versioned as a unit.
 */
export interface PluginPack {
  /** vendor-native id, e.g. "oh-my-claudecode@omc" */
  id: string;
  name: string;
  marketplace: string;
  /** marketplace origin, e.g. "github:owner/repo" or a git url */
  marketplaceSource?: string;
  version?: string;
  scope: "user" | "project";
  /** enabled per vendor settings (user + project layers) */
  enabled: boolean;
  /** install directory recorded by the vendor registry */
  path: string;
  /** whether the install directory actually exists */
  exists: boolean;
  components: PluginComponents;
  /** vendor registry file this entry was read from */
  sourcePath: string;
}

/* ------------------------- Permissions ------------------------- */

/** Lattice order: none < prompt < allowlist < full. */
export type ShellAccess = "none" | "prompt" | "allowlist" | "full";
/** Lattice order: read < prompt < workspace < full. */
export type FilesystemAccess = "read" | "prompt" | "workspace" | "full";
/** How faithfully a vendor setting maps onto a capability. */
export type Fidelity = "exact" | "lossy" | "unknown";

/**
 * Vendor-neutral capability set. A missing field means the vendor does not
 * express that capability (not "none"). See _docs/05-permission-layer.md.
 */
export interface Capabilities {
  shell?: ShellAccess;
  filesystem?: FilesystemAccess;
  network?: boolean;
  /** MCP server ids reachable by the agent */
  mcp?: string[];
  /** prompts auto-approved / dangerous mode */
  bypassPrompts?: boolean;
  model?: string;
}

export interface PermissionRule {
  effect: "allow" | "deny" | "ask";
  /** vendor-native pattern, e.g. "Bash(git *)" */
  pattern: string;
  sourcePath: string;
}

export interface PermissionSurface {
  /** effective capabilities of the main agent */
  effective: Capabilities;
  fidelity: Partial<Record<keyof Capabilities, Fidelity>>;
  /** vendor label, e.g. Claude defaultMode or Codex "on-request/workspace-write" */
  mode?: string;
  rules: PermissionRule[];
  /** enterprise-managed policy file present (user settings cannot override it) */
  managedPolicyPath?: string;
  /** projects the vendor treats as trusted (portable paths) */
  trustedProjects?: string[];
}

export type ExtensionOrigin = "user" | "project" | `plugin:${string}`;

export interface HookRegistration {
  /** vendor event name, e.g. PreToolUse, PermissionRequest, SessionStart */
  event: string;
  matcher?: string;
  /** command line with plugin root variables expanded */
  command: string;
  origin: ExtensionOrigin;
  sourcePath: string;
}

export interface AgentDefinition {
  id: string;
  origin: ExtensionOrigin;
  path: string;
  model?: string;
  /** tool allowlist; undefined = inherits every tool of the main agent */
  tools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
}

export interface RuntimeState {
  id: string;
  name: string;
  installed: boolean;
  version?: string;
  adapterVersion: string;
  configSources: ConfigSource[];
  mcpServers: McpServer[];
  instructionPacks: InstructionPack[];
  skillPacks: SkillPack[];
  plugins: PluginPack[];
  /** undefined when the vendor exposes no permission surface the adapter reads */
  permissions?: PermissionSurface;
  hooks: HookRegistration[];
  agents: AgentDefinition[];
  /** adapter-level parse warnings that should surface in scan output */
  warnings: string[];
}

export interface EnvironmentSnapshot {
  schemaVersion: string;
  kind: "EnvironmentSnapshot";
  generatedAt: string;
  host: {
    os: string;
    arch: string;
    hostnameHash: string;
  };
  runtimes: RuntimeState[];
  findings: Finding[];
}

/* ------------------------- Desired state ------------------------- */

export interface DesiredEnvVar {
  source: "env" | "inline";
  required: boolean;
  /** always "redacted" for secrets; literal only for non-secret values */
  value?: string;
}

export interface DesiredMcpServer {
  id: string;
  enabled: boolean;
  allowedRuntimes: string[];
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: McpCommand;
  url?: string;
  env: Record<string, DesiredEnvVar>;
  /**
   * Unknown vendor fields keyed by the runtime they were read from
   * (e.g. { codex: { startup_timeout_sec: 15 } }). Apply only writes the
   * target runtime's own bucket, so vendor-specific keys never leak
   * across vendors when a server is shared via allowedRuntimes.
   */
  raw?: Record<string, Record<string, unknown>>;
}

export interface DesiredInstruction {
  id: string;
  type: "user" | "project";
  path: string;
  applyTo: string[];
}

export interface DesiredSkill {
  id: string;
  type: "user" | "project";
  path: string;
  applyTo: string[];
}

/** Plugins are check-only: drift reports them, apply never installs them. */
export interface DesiredPlugin {
  id: string;
  marketplace: string;
  marketplaceSource?: string;
  /** version observed at export time; drift reports a change when set */
  version?: string;
  scope: "user" | "project";
  enabled: boolean;
  applyTo: string[];
}

export interface DesiredState {
  schemaVersion: string;
  kind: "DesiredState";
  metadata: {
    name: string;
    description?: string;
    createdAt: string;
    /** last time `aem baseline update` accepted the current state into this profile */
    updatedAt?: string;
    /**
     * user (default): full user-level environment profile (~/.aem/profiles).
     * project: repo-committed profile (<repo>/.aem/desired-state.yaml)
     * containing only project-scope resources; check-only in the MVP.
     */
    scope?: "user" | "project";
    /** runtime versions observed at export time; used by drift detection */
    observedRuntimeVersions?: Record<string, string>;
  };
  targets: {
    runtimes: { id: string; enabled: boolean }[];
  };
  mcpServers: DesiredMcpServer[];
  instructions: DesiredInstruction[];
  skills: DesiredSkill[];
  plugins: DesiredPlugin[];
  policies: {
    secretHandling: "forbid-inline";
    unknownFields: "preserve";
  };
}

/* ------------------------- Policy ------------------------- */

export type HookPolicy = "allow" | "review" | "deny";

export interface AgentPolicy {
  /** upper bound; effective = narrow(main, agent) must not exceed it */
  ceiling?: Capabilities;
  /** lower bound the role needs to function */
  requires?: Pick<Capabilities, "shell" | "filesystem" | "network" | "mcp">;
}

/** Vendor-neutral permission policy (.aem/policy.yaml). Knows no vendor ids. */
export interface Policy {
  schemaVersion: string;
  kind: "Policy";
  metadata: {
    name: string;
    createdAt: string;
    scope?: "user" | "project";
  };
  /** main-agent ceiling; omitted capability = unconstrained */
  ceiling: Capabilities;
  hooks?: {
    events?: Record<string, HookPolicy>;
    allowOrigins?: ExtensionOrigin[];
  };
  /** keyed by agent id; "*" is the default for agents without an entry */
  agents?: Record<string, AgentPolicy>;
  extensions?: {
    plugins?: { allow?: string[]; deny?: string[] };
  };
}

export type CheckSubject =
  | "main"
  | `agent:${string}`
  | `hook:${string}`
  | `plugin:${string}`;

export interface CheckItem {
  runtime: string;
  subject: CheckSubject;
  severity: Severity;
  /** policy rule path, e.g. ceiling.shell, agents.reviewer.requires.mcp, hooks.events.PreToolUse */
  rule: string;
  message: string;
  fidelity?: Fidelity;
}

export interface CheckReport {
  schemaVersion: string;
  kind: "CheckReport";
  policy: string;
  generatedAt: string;
  items: CheckItem[];
}

/* ------------------------- Change plan ------------------------- */

export type ChangeAction = "add" | "update" | "remove" | "noop";

export interface Change {
  id: string;
  runtime: string;
  action: ChangeAction;
  /** canonical resource, e.g. mcp.github */
  resourceRef: string;
  targetPath: string;
  summary: string;
  risk: "low" | "medium" | "high";
  backupRequired: boolean;
  detail?: string[];
}

export interface ChangePlan {
  schemaVersion: string;
  kind: "ChangePlan";
  profile: string;
  generatedAt: string;
  changes: Change[];
}

/* ------------------------- Drift ------------------------- */

export interface DriftItem {
  runtime: string;
  kind: "mcp" | "instruction" | "skill" | "plugin" | "runtime-version";
  change: "added" | "removed" | "changed";
  resourceRef: string;
  detail: string;
}

export interface DriftReport {
  schemaVersion: string;
  kind: "DriftReport";
  profile: string;
  generatedAt: string;
  items: DriftItem[];
}
