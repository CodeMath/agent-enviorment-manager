import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import type { AdapterContext, AgentRuntimeAdapter } from "./types.js";
import { homeDir } from "../core/storage/paths.js";

export const ALL_ADAPTERS: AgentRuntimeAdapter[] = [
  codexAdapter,
  claudeCodeAdapter,
];

export function selectAdapters(vendor: string): AgentRuntimeAdapter[] {
  if (vendor === "all") return ALL_ADAPTERS;
  const map: Record<string, string> = {
    codex: "codex",
    claude: "claude-code",
    "claude-code": "claude-code",
  };
  const id = map[vendor];
  const found = ALL_ADAPTERS.filter((a) => a.id === id);
  if (found.length === 0) {
    throw new Error(
      `Unknown vendor "${vendor}". Supported: codex, claude, all.`,
    );
  }
  return found;
}

export function defaultContext(project?: string): AdapterContext {
  return {
    home: homeDir(),
    project: project ?? process.cwd(),
    env: process.env,
    allowExec: process.env.AEM_NO_EXEC !== "1",
  };
}
