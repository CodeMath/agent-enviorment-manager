import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  AgentDefinition,
  ExtensionOrigin,
  HookRegistration,
  PermissionRule,
  PermissionSurface,
  PluginPack,
} from "../../core/model/types.js";
import type { AdapterContext } from "../types.js";

function settingsLayers(ctx: AdapterContext): string[] {
  return [
    path.join(ctx.home, ".claude", "settings.json"),
    path.join(ctx.home, ".claude", "settings.local.json"),
    path.join(ctx.project, ".claude", "settings.json"),
    path.join(ctx.project, ".claude", "settings.local.json"),
  ];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(file: string, warnings: string[]): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isObject(value)) {
      warnings.push(`Unexpected JSON root in ${file}.`);
      return undefined;
    }
    return value;
  } catch (err) {
    warnings.push(`Could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

function layerOrigin(ctx: AdapterContext, file: string): ExtensionOrigin {
  return file === settingsLayers(ctx)[0] || file === settingsLayers(ctx)[1] ? "user" : "project";
}

function permissionRules(
  value: unknown,
  effect: PermissionRule["effect"],
  sourcePath: string,
): PermissionRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((pattern): pattern is string => typeof pattern === "string")
    .map((pattern) => ({ effect, pattern, sourcePath }));
}

function hasBare(rules: PermissionRule[], pattern: string): boolean {
  return rules.some((rule) => rule.pattern === pattern);
}

function hasPattern(rules: PermissionRule[], base: string): boolean {
  return rules.some((rule) => rule.pattern.startsWith(`${base}(`));
}

function hooksFrom(
  value: unknown,
  origin: ExtensionOrigin,
  sourcePath: string,
  pluginRoot?: string,
): HookRegistration[] {
  if (!isObject(value)) return [];
  const hooks: HookRegistration[] = [];
  for (const [event, registrations] of Object.entries(value)) {
    if (!Array.isArray(registrations)) continue;
    for (const registration of registrations) {
      if (!isObject(registration) || !Array.isArray(registration.hooks)) continue;
      const matcher = typeof registration.matcher === "string" ? registration.matcher : undefined;
      for (const hook of registration.hooks) {
        if (!isObject(hook) || hook.type !== "command" || typeof hook.command !== "string") continue;
        hooks.push({
          event,
          ...(matcher === undefined ? {} : { matcher }),
          command: pluginRoot === undefined
            ? hook.command
            : hook.command
                .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot)
                .replaceAll("$CLAUDE_PLUGIN_ROOT", pluginRoot),
          origin,
          sourcePath,
        });
      }
    }
  }
  return hooks;
}

function stringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : undefined;
  if (values === undefined) return undefined;
  return values.map((item) => item.trim()).filter(Boolean);
}

function markdownFiles(dir: string, warnings: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      warnings.push(`Could not read ${current}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
    }
  };
  walk(dir);
  return files;
}

function agentFrom(file: string, origin: ExtensionOrigin, warnings: string[]): AgentDefinition | undefined {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (err) {
    warnings.push(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  const id = path.basename(file, ".md");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { id, origin, path: file };
  try {
    const frontmatter: unknown = YAML.parse(match[1] ?? "");
    if (!isObject(frontmatter)) return { id, origin, path: file };
    const tools = stringList(frontmatter.tools);
    const disallowedTools = stringList(frontmatter.disallowedTools);
    return {
      id: typeof frontmatter.name === "string" ? frontmatter.name : id,
      origin,
      path: file,
      ...(typeof frontmatter.model === "string" ? { model: frontmatter.model } : {}),
      ...(tools === undefined ? {} : { tools }),
      ...(disallowedTools === undefined ? {} : { disallowedTools }),
      ...(typeof frontmatter.permissionMode === "string"
        ? { permissionMode: frontmatter.permissionMode }
        : {}),
    };
  } catch (err) {
    warnings.push(
      `Could not parse agent frontmatter in ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export function readClaudePermissions(
  ctx: AdapterContext,
  plugins: PluginPack[],
  mcpServerIds: string[],
  warnings: string[],
): { permissions: PermissionSurface; hooks: HookRegistration[]; agents: AgentDefinition[] } {
  const rules: PermissionRule[] = [];
  const hooks: HookRegistration[] = [];
  let defaultMode: string | undefined;
  let skipDangerousModePermissionPrompt = false;
  let model: string | undefined;

  for (const file of settingsLayers(ctx)) {
    const settings = readJson(file, warnings);
    if (!settings) continue;
    const permissions = isObject(settings.permissions) ? settings.permissions : undefined;
    rules.push(
      ...permissionRules(permissions?.allow, "allow", file),
      ...permissionRules(permissions?.deny, "deny", file),
      ...permissionRules(permissions?.ask, "ask", file),
    );
    if (typeof permissions?.defaultMode === "string") defaultMode = permissions.defaultMode;
    if (settings.skipDangerousModePermissionPrompt === true) {
      skipDangerousModePermissionPrompt = true;
    }
    if (typeof settings.model === "string") model = settings.model;
    hooks.push(...hooksFrom(settings.hooks, layerOrigin(ctx, file), file));
  }

  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.exists) continue;
    const hooksPath = path.join(plugin.path, "hooks", "hooks.json");
    const hookDoc = readJson(hooksPath, warnings);
    hooks.push(
      ...hooksFrom(
        hookDoc?.hooks ?? hookDoc,
        `plugin:${plugin.id}`,
        hooksPath,
        plugin.path,
      ),
    );
  }

  const bypassPrompts =
    defaultMode === "bypassPermissions" || skipDangerousModePermissionPrompt;
  const shell = bypassPrompts
    ? "full"
    : hasBare(rules.filter((rule) => rule.effect === "deny"), "Bash")
      ? "none"
      : hasBare(rules.filter((rule) => rule.effect === "allow"), "Bash")
        ? "full"
        : hasPattern(rules.filter((rule) => rule.effect === "allow"), "Bash")
          ? "allowlist"
          : "prompt";
  const denied = rules.filter((rule) => rule.effect === "deny");
  const allowed = rules.filter((rule) => rule.effect === "allow");
  const filesystem = bypassPrompts
    ? "full"
    : defaultMode === "acceptEdits"
      ? "workspace"
      : hasBare(denied, "Write") && hasBare(denied, "Edit")
        ? "read"
        : hasBare(allowed, "Write") || hasBare(allowed, "Edit")
          ? "workspace"
          : "prompt";
  const managedPolicyPath = [
    "/Library/Application Support/ClaudeCode/managed-settings.json",
    "/etc/claude-code/managed-settings.json",
  ].find((file) => fs.existsSync(file));

  const agentDirs: Array<[string, ExtensionOrigin]> = [
    [path.join(ctx.home, ".claude", "agents"), "user"],
    [path.join(ctx.project, ".claude", "agents"), "project"],
    ...plugins
      .filter((plugin) => plugin.enabled && plugin.exists)
      .map((plugin): [string, ExtensionOrigin] => [
        path.join(plugin.path, "agents"),
        `plugin:${plugin.id}`,
      ]),
  ];
  const agents = agentDirs.flatMap(([dir, origin]) =>
    markdownFiles(dir, warnings)
      .map((file) => agentFrom(file, origin, warnings))
      .filter((agent): agent is AgentDefinition => agent !== undefined),
  );

  return {
    permissions: {
      effective: {
        shell,
        filesystem,
        network: bypassPrompts || !(hasBare(denied, "WebFetch") && hasBare(denied, "WebSearch") && shell === "none"),
        mcp: mcpServerIds,
        bypassPrompts,
        ...(model === undefined ? {} : { model }),
      },
      fidelity: {
        shell: "exact",
        filesystem: "lossy",
        network: "lossy",
        mcp: "exact",
        bypassPrompts: "exact",
        model: "exact",
      },
      mode: `${defaultMode ?? "default"}${skipDangerousModePermissionPrompt ? " +skipDangerousModePermissionPrompt" : ""}`,
      rules,
      ...(managedPolicyPath === undefined ? {} : { managedPolicyPath }),
    },
    hooks,
    agents,
  };
}
