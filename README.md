# aem — Agent Environment Manager

Vendor-neutral desired-state manager for your **local AI agent environment**.

`aem` detects what is installed and configured across your AI coding agents (Claude Code, Codex, and 10 more — runtimes, MCP servers, instructions, skills), normalizes it into a canonical model, and lets you save/restore/verify that environment as a declarative profile — with dry-run diffs, backups, and secret redaction built in.

> **Show me what my agent environment contains, how it differs from my saved standard, and bring it back in line — safely.**

## Why aem

AI agents are becoming the default execution unit of development work — and an agent's behavior depends as much on its *environment* as on its prompt. Yet that environment is scattered and invisible:

- **Fragmented state.** MCP servers, instructions (`AGENTS.md`, `CLAUDE.md`), skills, permissions, and env vars live in a different file format and location for every vendor (`~/.codex/config.toml`, `~/.claude.json`, `~/.gemini/settings.json`, …). Nobody can answer "what is my agent allowed to do right now?" in one place.
- **No reproducibility.** Two developers on the same repo get different agent behavior because their local MCP servers, instructions, and versions differ. That's not just a productivity gap — it's a quality, security, and audit problem: an inline API key here, a stale skill there, a `prod-db-write` MCP only one person has.
- **The dotfiles trap.** Today this is managed like 2010-era shell config: manual edits, tribal knowledge, and "copy my settings" onboarding docs. Config changes leave no history, no diff, no rollback.
- **The governance gap.** Central agent registries and security policies can define what's *approved*, but nothing translates that into each developer's actual vendor-native config files — or verifies the local reality matches.

`aem`'s answer is to move agent environments from *dotfiles + memory* to **declarative desired state**, the same shift infrastructure made with IaC:

1. **Detect** current state and **normalize** it into one canonical model (vendor-neutral).
2. **Declare** the state you want as a redacted, portable profile.
3. **Plan** changes as a reviewable diff, **verify** risks with `doctor`, **apply** with backups, and **detect drift** over time.

Three principles keep this trustworthy:

- **Vendor-native is respected.** `aem` doesn't replace your agents or wrap their runtimes; adapters translate the canonical model to and from each vendor's own config files, preserving unknown fields.
- **Local-first.** No account, no server, no telemetry. Everything works offline and stays in `~/.aem/`; only the opt-in `aem update` touches the network.
- **Secrets are references, never values.** Tokens and keys are redacted at the adapter boundary and can never enter profiles, output, or audit logs.

Full rationale, scope boundaries, and the Free → Team → Enterprise trajectory live in [`_docs/`](_docs/) (philosophy & policy, roadmap, MVP functional spec).

## Install (local production)

From a release (recommended — prebuilt tarball, no local build needed):

```bash
npm install -g https://github.com/CodeMath/agent-enviorment-manager/releases/download/v0.2.0/agent-environment-manager-0.2.0.tgz
aem --version
```

From a checkout:

```bash
npm install          # deps + build (prepare hook)
npm install -g .     # installs the `aem` binary
```

Requires Node >= 20. Tests run with `bun test`.

Upgrade later with the built-in updater:

```bash
aem update --check   # exit 4 when a newer release exists
aem update           # installs the latest GitHub release
```

## Quick start

```bash
aem scan                             # what is my agent environment?
aem doctor                           # what is risky, broken, or missing?
aem export --profile personal-default   # save current env as a redacted profile
aem profile use personal-default        # make it the active profile
aem diff                             # what would change to match the profile?
aem apply --dry-run                  # same change plan, guaranteed no writes
aem apply                            # backup + apply (asks for confirmation)
aem drift                            # has my env drifted from the profile?
```

Move a profile to another machine:

```bash
aem export --profile personal-default --out ./env.yaml
# on the other machine:
aem import ./env.yaml
aem diff --profile personal-default
aem apply --profile personal-default
```

## Commands

| Command | Writes vendor config? | Purpose |
| --- | --- | --- |
| `aem scan [--json] [--vendor codex\|claude\|all] [--project <path>]` | no | Detect runtimes, config sources, MCP servers, instructions, skills |
| `aem init [--force]` | no (writes `<cwd>/.aem/`) | Generate a committable project-scope baseline (`.aem/desired-state.yaml`) |
| `aem doctor [--json] [--vendor] [--profile <name>]` | no | Findings: `missing_env`, `secret_inline`, `broken_path`, `duplicate_mcp`, `dangerous_command`, `unknown_config`, `stale_profile`, `drift_detected`, `unsupported_version` |
| `aem export --profile <name> [--out <path>] [--force]` | no | Current state → redacted DesiredState YAML |
| `aem import <file> [--name <n>] [--force]` | no | Validate + register a profile (rejects inline secrets, wrong schema) |
| `aem profile list/show/use/delete` | no | Manage profiles; `use` sets the default for diff/apply/drift |
| `aem diff [--profile <name>] [--json]` | no | Change plan (add/update/remove/no-op) — same engine as apply |
| `aem apply [--profile] [--dry-run] [--yes]` | **yes** (with backup) | Materialize the profile into vendor-native config |
| `aem drift [--profile] [--json]` | no | MCP/instruction/skill/runtime-version drift vs profile (exit 3 on drift) |
| `aem update [--check]` | no (updates aem itself) | Check GitHub releases; self-update via `npm install -g` from the release tag |

Exit codes: `0` ok · `1` command error · `2` doctor found error/critical · `3` drift detected · `4` update available (`update --check`).

`update` is the only command that touches the network, and only when you run it — scan/doctor/diff/apply stay fully offline (local-first policy).

## Supported vendors

Vendor inventory cross-checked against the AI coding agent list maintained by [tokscale](https://github.com/junhoyeo/tokscale).

| Vendor | Detect / Doctor / Drift | Apply | Config read |
| --- | :---: | :---: | --- |
| Codex | ✅ | ✅ | `~/.codex/config.toml` (`[mcp_servers.*]`), `AGENTS.md`, skills |
| Claude Code | ✅ | ✅ | `~/.claude.json` (`mcpServers`), `.mcp.json`, settings, `CLAUDE.md`, skills/agents |
| Gemini CLI | ✅ | read-only | `~/.gemini/settings.json` (`mcpServers`), `GEMINI.md` |
| Qwen Code | ✅ | read-only | `~/.qwen/settings.json`, `QWEN.md` |
| Cursor | ✅ | read-only | `~/.cursor/mcp.json`, project `.cursor/mcp.json`, `.cursorrules` |
| GitHub Copilot CLI | ✅ | read-only | `~/.copilot/mcp-config.json`, `.github/copilot-instructions.md` |
| OpenCode | ✅ | read-only | `~/.config/opencode/opencode.json` (`mcp`, array-command form), project `opencode.json` |
| Amp | ✅ | read-only | `~/.config/amp/settings.json` (`amp.mcpServers`) |
| Kiro | ✅ | read-only | `~/.kiro/settings/mcp.json`, project `.kiro/settings/mcp.json`, steering |
| Factory Droid | ✅ | read-only | `~/.factory/mcp.json` |
| Goose | ✅ (detect) | read-only | `~/.config/goose/config.yaml` |
| Zed Agent | ✅ | read-only | `~/.config/zed/settings.json` (`context_servers`) |
| Crush | ✅ | read-only | `~/.config/crush/crush.json` (`mcp`), project `crush.json`/`.crush.json` |
| Cline | ✅ | read-only | VS Code globalStorage `cline_mcp_settings.json`, `.clinerules` |
| Roo Code | ✅ | read-only | globalStorage `mcp_settings.json`, project `.roo/mcp.json` |
| Kilo Code | ✅ | read-only | globalStorage `mcp_settings.json`, project `.kilocode/mcp.json` |
| Grok CLI | ✅ | read-only | `~/.grok/user-settings.json` (`mcpServers`) |

**Detect-tier** (installation/version detection feeding `scan` and profile inventory): OpenClaw, Prime Agent, Hermes Agent, Pi, Oh My Pi, Senpi, Kimchi Coding, Kimi CLI/Code, Codebuff, Antigravity CLI, Warp, Devin CLI, Augment (Auggie), Jcode, MiMo Code, Junie, Command Code, ZCode, OpenCodeReview, CodeBuddy, WorkBuddy, DeepSeek Harness, fx, Mux, Gajae Code, LM Studio, Octofriend, Cherry Studio.

Read-only vendors are declared in a single declarative catalog (`src/adapters/catalog.ts`); their MCP servers are normalized into the same canonical model, so `doctor` (inline secrets, missing env, broken paths, cross-vendor duplicates) and `drift` work across all of them. Generic binary names (`pi`, `mux`, `fx`, …) are deliberately not probed — presence directories only — to avoid false positives from unrelated tools. Promoting a vendor to full apply support means implementing `apply`/`backupTargets` for it.

## Profiles: user scope vs project scope

- **User profiles** (`~/.aem/profiles/*.yaml`, via `aem export`) capture the full environment — user-level and project-level resources — and drive `diff`/`apply`/`drift`.
- **Project profiles** (`<repo>/.aem/desired-state.yaml`, via `aem init`) capture **only project-scope resources**: project MCP config (e.g. `.mcp.json`, `.cursor/mcp.json`), project instructions (`AGENTS.md`, `CLAUDE.md`), and project skills. Personal user-level servers never leak into the repo-committed file.
- Profile resolution order for `drift`/`doctor` (and `diff`/`apply`): explicit `--profile` → `<cwd>/.aem/desired-state.yaml` when present → the active profile.
- Project profiles are **check-only** in the MVP (per spec: project dir support is read-only): `drift` and `doctor` validate them — scope-aware, so user-level changes never flag a project baseline — while `diff`/`apply` refuse them with a clear error. This is the on-ramp to the Phase 3 team baseline (`.aem/team.yaml`).
- Portability: home paths become `~`, project paths become `${PROJECT_ROOT}` (embedded occurrences included), project instruction/skill paths are stored `./`-relative. Symlink spellings (macOS `/var` vs `/private/var`, `/tmp` vs `/private/tmp`) are treated as identical.

## What gets managed vs observed

- **Managed by apply (MVP):** MCP servers — Codex `~/.codex/config.toml` `[mcp_servers.*]`, Claude Code `~/.claude.json` `mcpServers`. Servers present locally but absent from the profile are left untouched (surfaced by `drift`, not deleted).
- **Observed read-only:** instructions (`AGENTS.md`, `CLAUDE.md`), skills/agents directories, config sources, runtime versions, and all catalog vendors above. These feed `scan`/`doctor`/`drift` and are recorded in exported profiles.
- Vendor binary versions are cached in `~/.aem/adapters/cache.json` (keyed by binary path + mtime) so repeated scans stay fast (<0.1s warm).

## Safety model

- `scan`/`doctor`/`diff`/`drift`/`export`/`import` never touch vendor config.
- `apply --dry-run` is guaranteed write-free (tested).
- `apply` backs every target file up to `~/.aem/backups/<timestamp>/<vendor>/...` first, and records the result in `~/.aem/audit/events.jsonl`.
- Unknown vendor fields are preserved through read → export → apply.
- **Secrets are references, never values.** Secret-looking values (key-name heuristics + token-shape patterns) are dropped at the adapter boundary; a final export guard refuses to serialize anything secret-looking, and `import` rejects profiles that contain one.
- **Profiles are machine-portable.** Absolute home paths are rewritten to `~` on export — including paths embedded inside larger values (e.g. JSON strings in env vars) — and expanded back to the target machine's home on diff/apply.
- Known limitation: applying to `~/.codex/config.toml` re-serializes the TOML, so comments/formatting in that file are not preserved (values are). The pre-apply backup keeps the original.

## Local storage layout

```
~/.aem/
  config.yaml          # active profile
  state/current.json   # last canonical EnvironmentSnapshot
  snapshots/           # timestamped snapshots
  profiles/*.yaml      # DesiredState profiles (schemaVersion aem.dev/v0)
  backups/<ts>/<vendor>/...
  audit/events.jsonl   # append-only local audit log
```

## Development

```bash
npm run build      # tsc -> dist/
npm run typecheck
bun test           # unit + fixture + CLI round-trip integration (temp HOME)
```

Test-only env overrides: `AEM_HOME` (store + discovery root), `AEM_DIR` (store root only), `AEM_NO_EXEC=1` (skip vendor binary version probing).

## Architecture

```
src/
  cli/                 # commander wiring + commands (thin)
  core/
    model/             # canonical model v0 (Snapshot, DesiredState, ChangePlan, Finding, Drift)
    redaction/         # secret heuristics + export guard
    storage/           # ~/.aem store, backups, audit
    planner/           # shared diff/apply change-plan engine
    doctor/            # cross-vendor findings
    drift/             # profile vs current comparison
  adapters/
    codex/             # ~/.codex/config.toml (TOML) — full apply support
    claude-code/       # ~/.claude.json, .mcp.json (JSON) — full apply support
    catalog.ts         # declarative read-only vendor catalog (10 vendors)
  output/              # human-readable text rendering
```

Adapters implement `read / doctor / backupTargets / apply`; one adapter failing never blocks the others. Adding a read-only vendor is one `VendorSpec` entry in the catalog — the canonical model and planner stay untouched.

## Roadmap

This is the Phase 1 **Local MVP** from `_docs/02-side-project-roadmap.md`. Next: `aem init`/`aem status`/profile templates (Phase 2, personal productivity), then `.aem/team.yaml` + CI checks (Phase 3, team baseline), then registry/governance connectors.
