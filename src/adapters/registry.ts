import { CATALOG_ADAPTERS } from "./catalog.js";
import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import type { AdapterContext, AgentRuntimeAdapter } from "./types.js";
import { homeDir } from "../core/storage/paths.js";

export const ALL_ADAPTERS: AgentRuntimeAdapter[] = [
  codexAdapter,
  claudeCodeAdapter,
  ...CATALOG_ADAPTERS,
];

const ALIASES: Record<string, string> = {
  claude: "claude-code",
  factory: "droid",
  "gemini-cli": "gemini",
};

export function selectAdapters(vendor: string): AgentRuntimeAdapter[] {
  if (vendor === "all") return ALL_ADAPTERS;
  const id = ALIASES[vendor] ?? vendor;
  const found = ALL_ADAPTERS.filter((a) => a.id === id);
  if (found.length === 0) {
    throw new Error(
      `Unknown vendor "${vendor}". Supported: all, ${ALL_ADAPTERS.map((a) => a.id).join(", ")}.`,
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
