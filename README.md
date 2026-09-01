# aem — Agent Environment Manager

Vendor-neutral desired-state manager for your **local AI agent environment**.

`aem` detects what is installed and configured for Claude Code and Codex (runtimes, MCP servers, instructions, skills), normalizes it into a canonical model, and lets you save/restore/verify that environment as a declarative profile — with dry-run diffs, backups, and secret redaction built in.

> "내 Claude Code/Codex 환경에 무엇이 설치되어 있고, 저장된 표준과 무엇이 다른지 보여주고, 안전하게 맞춰준다."

Design docs live in [`_docs/`](_docs/) (philosophy & policy, roadmap, MVP functional spec).

## Install (local production)

From a release tag (recommended):

```bash
npm install -g github:CodeMath/agent-enviorment-manager#v0.1.0
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

## What gets managed vs observed

- **Managed by apply (MVP):** MCP servers — Codex `~/.codex/config.toml` `[mcp_servers.*]`, Claude Code `~/.claude.json` `mcpServers`. Servers present locally but absent from the profile are left untouched (surfaced by `drift`, not deleted).
- **Observed read-only:** instructions (`AGENTS.md`, `CLAUDE.md`), skills/agents directories, config sources, runtime versions. These feed `scan`/`doctor`/`drift`.

## Safety model

- `scan`/`doctor`/`diff`/`drift`/`export`/`import` never touch vendor config.
- `apply --dry-run` is guaranteed write-free (tested).
- `apply` backs every target file up to `~/.aem/backups/<timestamp>/<vendor>/...` first, and records the result in `~/.aem/audit/events.jsonl`.
- Unknown vendor fields are preserved through read → export → apply.
- **Secrets are references, never values.** Secret-looking values (key-name heuristics + token-shape patterns) are dropped at the adapter boundary; a final export guard refuses to serialize anything secret-looking, and `import` rejects profiles that contain one.
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
    codex/             # ~/.codex/config.toml (TOML)
    claude-code/       # ~/.claude.json, .mcp.json (JSON)
  output/              # human-readable text rendering
```

Adapters implement `read / doctor / backupTargets / apply`; one adapter failing never blocks the others. Adding a vendor (Cursor, Gemini CLI, …) means one new adapter module — the canonical model and planner stay untouched.

## Roadmap

This is the Phase 1 **Local MVP** from `_docs/02-side-project-roadmap.md`. Next: `aem init`/`aem status`/profile templates (Phase 2, personal productivity), then `.aem/team.yaml` + CI checks (Phase 3, team baseline), then registry/governance connectors.
