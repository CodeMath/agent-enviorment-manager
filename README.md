# aem — Agent Environment Manager

Vendor-neutral desired-state manager for your **local AI agent environment**.

`aem` detects what is installed and configured across your AI coding agents (Claude Code, Codex, and 40+ more — runtimes, MCP servers, instructions, skills, plugins), normalizes it into a canonical model, and lets you save/restore/verify that environment as a declarative profile — with dry-run diffs, backups, and secret redaction built in.

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
npm install -g https://github.com/CodeMath/agent-enviorment-manager/releases/download/v0.7.0/agent-environment-manager-0.7.0.tgz
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

Declare a project baseline and keep it honest:

```bash
cd my-repo
aem init                 # writes .aem/desired-state.yaml (project scope only)
git add .aem/desired-state.yaml
aem drift                # auto-resolves the project baseline in this directory
aem doctor               # includes drift_detected findings for the baseline
```

## Commands

| Command | Writes vendor config? | Purpose |
| --- | --- | --- |
| `aem scan [--json] [--vendor <id>\|all] [--project <path>]` | no | Detect runtimes, config sources, MCP servers, instructions, skills, plugins |
| `aem init [--force]` | no (writes `<cwd>/.aem/`) | Generate a committable project-scope baseline (`.aem/desired-state.yaml`) and a permission policy scaffold (`.aem/policy.yaml`) |
| `aem doctor [--json] [--vendor] [--profile <name>]` | no | Findings: `missing_env`, `secret_inline`, `broken_path`, `duplicate_mcp`, `dangerous_command`, `unknown_config`, `stale_profile`, `drift_detected`, `unsupported_version`, `permission_risk`, `hook_risk`, `policy_violation` |
| `aem check [--policy <file>] [--json]` | no | Verify main agent, sub-agents, hooks and plugins against the vendor-neutral `.aem/policy.yaml` ceiling (exit 5 on violation) |
| `aem export --profile <name> [--out <path>] [--force]` | no | Current state → redacted DesiredState YAML |
| `aem import <file> [--name <n>] [--force]` | no | Validate + register a profile (rejects inline secrets, wrong schema) |
| `aem profile list/show/use/delete` | no | Manage profiles; `use` sets the default for diff/apply/drift |
| `aem diff [--profile <name>] [--json]` | no | Change plan (add/update/remove/no-op) — same engine as apply |
| `aem apply [--profile] [--dry-run] [--yes]` | **yes** (with backup) | Materialize the profile into vendor-native config |
| `aem drift [--profile] [--json]` | no | MCP/instruction/skill/plugin/runtime-version drift vs profile (exit 3 on drift) |
| `aem baseline update [--profile] [--yes] [--json]` | no (rewrites the profile) | Accept the current environment as the new desired state of the resolved profile; previous profile backed up, audit event recorded |
| `aem web [--port 4310] [--no-open]` | no | Read-only local dashboard: runtimes, MCP, plugins, skills, findings, drift (127.0.0.1 only) |
| `aem update [--check]` | no (updates aem itself) | Check GitHub releases; self-update via `npm install -g` from the release tag |

Exit codes: `0` ok · `1` command error · `2` doctor found error/critical · `3` drift detected · `4` update available (`update --check`) · `5` policy violation (`check`).

`update` is the only command that touches the network, and only when you run it — scan/doctor/diff/apply stay fully offline (local-first policy).

## Local dashboard

```bash
aem web            # http://127.0.0.1:4310, opens your browser
```

A single-file, fully offline visualization of the canonical model: runtime grid, MCP server table (env refs flagged inline-secret/missing), plugin table, doctor findings, drift vs the project baseline or active profile, instructions and skills. Deliberately **read-only** — it binds `127.0.0.1`, serves GET only, and has no apply/import endpoints: mutations stay in the CLI where confirmation, backups, and audit live. No CDN, no build step, no telemetry — the roadmap's "defer web dashboards" applies to hosted/central dashboards, not this local viewer.

## Permissions: what is my agent allowed to do?

Configuration mostly freezes at project start; after that, permissions arrive through **extensions** — plugins bring hooks (including `PermissionRequest`/`PreToolUse` hooks that can answer prompts), bundled MCP servers, and sub-agents with their own tool lists. `aem` reads that whole surface into one vendor-neutral capability model (`shell`, `filesystem`, `network`, `mcp`, `bypassPrompts`, `model`) with a per-field fidelity tag (`exact`/`lossy`) so lossy vendor mappings are never presented as facts:

- **Claude Code**: `permissions.allow/deny/ask`, `defaultMode`, `skipDangerousModePermissionPrompt`, managed-settings presence, `hooks` from every settings layer and every enabled plugin, sub-agents from `~/.claude/agents`, `.claude/agents`, and plugin `agents/` (frontmatter `tools`/`disallowedTools`/`model`).
- **Codex**: `approval_policy`, `sandbox_mode`, `[sandbox_workspace_write]`, active `profile`, `[projects.*] trust_level`.

`aem scan` prints the effective capabilities of each runtime and of every sub-agent (narrowed from the main agent — sub-agents can only lose capabilities, never gain them), plus hook registrations per origin. `aem doctor` flags bypassed prompts, full shell + network, broad trusted paths, and permission-influencing hooks. `aem init` writes `.aem/policy.yaml`: a ceiling derived from the current state (with `bypassPrompts: false` forced, so an unsafe local setup is flagged on day one), hook event rules (`PermissionRequest: deny`, everything else `review`), a default sub-agent ceiling, and the plugin allow list. `aem check` then verifies the local reality against it — main ceiling, per-agent ceiling/`requires`, hook events/origins, plugin allow/deny — and exits 5 on violations. The policy knows no vendor ids: commit it and every team member is checked on whichever vendor they use.

`aem` is a policy compiler and auditor, not a runtime enforcer: enforcement stays with the vendor's own mechanisms (Claude `permissions`/managed settings, Codex sandbox/approval). Compiling `policy.yaml` back into vendor-native settings is the next step (v0.8); v0.7 never writes vendor config. Design notes: `_docs/05-permission-layer.md`.

## Supported vendors

Vendor inventory cross-checked against the AI coding agent list maintained by [tokscale](https://github.com/junhoyeo/tokscale).

| Vendor | Detect / Doctor / Drift | Apply | Config read |
| --- | :---: | :---: | --- |
| Codex | ✅ | ✅ | `~/.codex/config.toml` (`[mcp_servers.*]`, `approval_policy`, `sandbox_mode`, `[projects.*]`), `AGENTS.md`, skills |
| Claude Code | ✅ | ✅ | `~/.claude.json` (`mcpServers`), `.mcp.json`, settings (`permissions`, `hooks`), `CLAUDE.md`, skills/agents, plugins (`~/.claude/plugins`) |
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
- Profile resolution order for `drift`/`doctor`/`baseline update` (and `diff`/`apply`): explicit `--profile` → `<cwd>/.aem/desired-state.yaml` when present → the active profile.
- Closing the loop: when `drift` reports intentional changes, `aem baseline update` pulls the current environment into the profile (the inverse of `apply`). It shows the drift items being accepted, asks for confirmation (`--yes` for non-interactive), keeps the profile's scope/description/`createdAt`, stamps `updatedAt`, backs up the previous file to `~/.aem/backups/<ts>/profiles/`, and logs the accepted items to the audit log. For a project baseline it regenerates `.aem/desired-state.yaml` in place (same as `init --force`, but only after showing what changed).
- Project profiles are **check-only** in the MVP (per spec: project dir support is read-only): `drift` and `doctor` validate them — scope-aware, so user-level changes never flag a project baseline — while `diff`/`apply` refuse them with a clear error. This is the on-ramp to the Phase 3 team baseline (`.aem/team.yaml`).
- Vendor-specific MCP fields (`raw`) are stored per runtime (`raw: { codex: {...} }`) so a server shared across vendors via `allowedRuntimes` never leaks one vendor's keys into another's config on apply.
- Portability: home paths become `~`, project paths become `${PROJECT_ROOT}` (embedded occurrences included), project instruction/skill paths are stored `./`-relative. Symlink spellings (macOS `/var` vs `/private/var`, `/tmp` vs `/private/tmp`) are treated as identical.

## What gets managed vs observed

- **Managed by apply (MVP):** MCP servers — Codex `~/.codex/config.toml` `[mcp_servers.*]`, Claude Code `~/.claude.json` `mcpServers`. Servers present locally but absent from the profile are left untouched (surfaced by `drift`, not deleted).
- **Observed read-only:** instructions (`AGENTS.md`, `CLAUDE.md`), skills/agents directories, plugins, permission surfaces, hooks, sub-agent definitions, config sources, runtime versions, and all catalog vendors above. These feed `scan`/`doctor`/`drift` and are recorded in exported profiles.
- **Claude Code plugins** (`~/.claude/plugins/installed_plugins.json` + `enabledPlugins` in user/project `settings.json`) are inventoried as a unit: id (`name@marketplace`), version, scope, enabled flag, marketplace origin, and bundled components (skills/agents/commands/hooks/MCP). MCP servers shipped by an *enabled* plugin appear in `scan`/`doctor` as `plugin:<name>:<server>` (with `${CLAUDE_PLUGIN_ROOT}` expanded) but are never exported or applied individually — the plugin entry is the managed unit. `drift` reports plugins missing/extra/disabled/version-changed with the `claude plugin marketplace add … && claude plugin install …` hint; `doctor` flags registry entries whose install dir is gone and plugins enabled in settings but not installed. Installing plugins stays with the vendor CLI (network + marketplace trust), so plugins are check-only.
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
  adapters/cache.json  # binary version cache (path + mtime keyed)

<repo>/.aem/
  desired-state.yaml   # committable project-scope baseline (aem init)
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
    catalog.ts         # declarative read-only vendor catalog (41 vendors)
  output/              # human-readable text rendering
  web/                 # aem web: read-only local dashboard (embedded single-file UI)
```

Adapters implement `read / doctor / backupTargets / apply`; one adapter failing never blocks the others. Adding a read-only vendor is one `VendorSpec` entry in the catalog — the canonical model and planner stay untouched.

## Roadmap & status

Phases refer to `_docs/02-side-project-roadmap.md`; implementation status is tracked in [`_docs/04-implementation-status.md`](_docs/04-implementation-status.md).

- **Phase 1 — Local MVP: complete** (v0.1.0). All eight core commands, Claude Code + Codex full adapters, safe apply with backups, drift detection, secret redaction. Milestones M0–M5 done.
- **Phase 2 — Personal productivity: partial.** Done ahead of plan: `aem init` + project-scope profiles (v0.4.0), machine-portable profiles (`~`/`${PROJECT_ROOT}`, v0.3.0), `aem baseline update` + Claude Code plugin inventory (v0.6.0), self-update via GitHub releases (v0.1.0+). Remaining: `aem status`, `aem history`, profile templates, shell completion, Homebrew, CI read-only check.
- **Phase 3 — Team baseline: next.** `.aem/team.yaml`, policy lint, `aem check --team`, role profiles. Project profiles (check-only) are the designed on-ramp.
- **Phases 4–5 — Governance connectors / enterprise control plane: not started** (deliberately — the roadmap forbids SaaS before the Free/Team CLI is proven).

Beyond the original plan: the vendor catalog covers the full [tokscale](https://github.com/junhoyeo/tokscale) agent inventory (43 vendors), and releases ship as prebuilt tarball assets consumed by `aem update`.
