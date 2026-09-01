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

export const CODEX_FIXTURE_TOML = `
model = "gpt-5.5"

[mcp_servers.github]
command = "npx"
args = [ "-y", "@modelcontextprotocol/server-github" ]
startup_timeout_sec = 15

[mcp_servers.github.env]
GITHUB_TOKEN = "\${GITHUB_TOKEN}"

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

/** Build a fixture home with codex + claude configs. */
export function seedFixtureHome(home: string): void {
  fs.mkdirSync(path.join(home, ".codex", "skills", "ralph"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), CODEX_FIXTURE_TOML);
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
