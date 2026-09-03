import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdapterContext } from "../src/adapters/types.js";

export function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aem-test-"));
}

export function ctxFor(home: string, project?: string): AdapterContext {
  return {
    home,
    project: project ?? path.join(home, "project"),
    env: { PATH: process.env.PATH, HOME: home },
    allowExec: false,
  };
}

export const codexFixtureToml = (home: string) => `
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = [ "-y", "@modelcontextprotocol/server-github" ]
startup_timeout_sec = 15

[mcp_servers.github.env]
GITHUB_TOKEN = "\${GITHUB_TOKEN}"
SERVICES_JSON = '{"browser":"${home}/.codex/plugins/browser.mjs","sky":"@oai/sky"}'

[mcp_servers.leaky]
command = "npx"
args = [ "-y", "some-server" ]
custom_field = "keep-me"

[mcp_servers.leaky.env]
SERVICE_API_KEY = "sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1"

[mcp_servers.shell]
command = "bash"
args = [ "-c", "some-tool" ]
`;

export const CLAUDE_FIXTURE_JSON = {
  numStartups: 3,
  mcpServers: {
    playwright: {
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
      timeout: 15,
    },
    leaky: {
      command: "npx",
      args: ["-y", "some-server"],
      env: { SERVICE_API_KEY: "sk-P2vytMQedM9v8PQjv8cTx4TPfHPmU6j1" },
    },
  },
  unrelatedState: { keep: true },
};

/**
 * Seed a Claude Code plugin registry: one enabled user plugin bundling an
 * MCP server + skills, one disabled plugin, one enabled plugin whose install
 * dir is gone, and a project-scope plugin bound to another repo.
 */
export function seedClaudePlugins(home: string): void {
  const pluginsDir = path.join(home, ".claude", "plugins");
  const omc = path.join(pluginsDir, "cache", "omc", "oh-my-claudecode", "5.1.0");
  fs.mkdirSync(path.join(omc, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(omc, "skills", "autopilot"), { recursive: true });
  fs.mkdirSync(path.join(omc, "skills", "debug"), { recursive: true });
  fs.mkdirSync(path.join(omc, "agents"), { recursive: true });
  fs.writeFileSync(path.join(omc, "agents", "architect.md"), "# agent\n");
  fs.writeFileSync(
    path.join(omc, "agents", "analyst.md"),
    "---\ndisallowedTools: Write, Edit\n---\n# analyst\n",
  );
  fs.mkdirSync(path.join(omc, "hooks"), { recursive: true });
  fs.writeFileSync(
    path.join(omc, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PermissionRequest: [
          {
            hooks: [{ type: "command", command: "\"$CLAUDE_PLUGIN_ROOT\"/scripts/x.cjs" }],
          },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(omc, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "oh-my-claudecode", version: "5.1.0" }),
  );
  fs.writeFileSync(
    path.join(omc, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        t: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/bridge/mcp-server.cjs"] },
      },
    }),
  );
  const discord = path.join(pluginsDir, "cache", "claude-plugins-official", "discord", "0.0.4");
  fs.mkdirSync(path.join(discord, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(discord, ".mcp.json"),
    JSON.stringify({ mcpServers: { discord: { command: "bun", args: ["start"] } } }),
  );

  fs.writeFileSync(
    path.join(pluginsDir, "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "oh-my-claudecode@omc": [
          { scope: "user", installPath: omc, version: "5.1.0" },
        ],
        "discord@claude-plugins-official": [
          { scope: "user", installPath: discord, version: "0.0.4" },
        ],
        "ghost@omc": [
          { scope: "user", installPath: path.join(pluginsDir, "cache", "omc", "ghost", "1.0.0"), version: "1.0.0" },
        ],
        "novel-studio@awesome-ai-studio": [
          {
            scope: "project",
            projectPath: path.join(home, "other-repo"),
            installPath: path.join(pluginsDir, "cache", "awesome-ai-studio", "novel-studio", "1.1.0"),
            version: "1.1.0",
          },
        ],
      },
    }),
  );
  fs.writeFileSync(
    path.join(pluginsDir, "known_marketplaces.json"),
    JSON.stringify({
      omc: { source: { source: "git", url: "https://github.com/Yeachan-Heo/oh-my-claudecode.git" } },
      "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
    }),
  );
  const settingsPath = path.join(home, ".claude", "settings.json");
  const settings = fs.existsSync(settingsPath)
    ? (JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>)
    : {};
  settings.enabledPlugins = {
    "oh-my-claudecode@omc": true,
    "discord@claude-plugins-official": false,
    "ghost@omc": true,
    "phantom@omc": true,
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
}

export function seedClaudePermissions(home: string): void {
  const claudeDir = path.join(home, ".claude");
  fs.mkdirSync(path.join(claudeDir, "agents"), { recursive: true });
  const settingsPath = path.join(claudeDir, "settings.json");
  const settings = fs.existsSync(settingsPath)
    ? (JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>)
    : {};
  settings.permissions = {
    allow: ["Bash(git *)", "Read"],
    deny: ["WebFetch"],
    defaultMode: "acceptEdits",
  };
  settings.model = "opus";
  settings.hooks = {
    PreToolUse: [
      {
        hooks: [{ type: "command", command: "node scripts/user-hook.cjs" }],
      },
    ],
  };
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  const statePath = path.join(home, ".claude.json");
  const state = fs.existsSync(statePath)
    ? (JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>)
    : {};
  state.mcpServers = {
    ...(typeof state.mcpServers === "object" && state.mcpServers !== null
      ? state.mcpServers
      : {}),
    github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
  };
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.writeFileSync(
    path.join(claudeDir, "agents", "reviewer.md"),
    "---\ntools: Read, Grep, mcp__github__search\nmodel: sonnet\n---\n# reviewer\n",
  );
  fs.writeFileSync(path.join(claudeDir, "agents", "bare.md"), "# bare\n");
}

/** Build a fixture home with codex + claude configs. */
export function seedFixtureHome(home: string): void {
  fs.mkdirSync(path.join(home, ".codex", "skills", "ralph"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), codexFixtureToml(home));
  fs.writeFileSync(path.join(home, ".codex", "AGENTS.md"), "# codex agents\n");
  fs.mkdirSync(path.join(home, ".claude", "skills", "reviewer"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify(CLAUDE_FIXTURE_JSON, null, 2),
  );
  fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "# memory\n");
  fs.mkdirSync(path.join(home, "project"), { recursive: true });
}
