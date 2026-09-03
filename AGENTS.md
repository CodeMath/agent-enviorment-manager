# Repository Guidelines

## Project Overview

`aem` (Agent Environment Manager, npm package `agent-environment-manager`) is a local-first CLI that detects what is installed and configured across AI coding agents (Claude Code, Codex, plus a 40+ vendor read-only catalog), normalizes it into a canonical model (`aem.dev/v0`), and lets you export/import/diff/apply/drift that environment as a declarative profile. Secrets are never stored by value; apply is always backed up, confirmed, and audited; nothing touches the network except `aem update`.

Governing docs live in `_docs/` (Korean prose, English identifiers): `01` philosophy/policy, `02` roadmap, `03` MVP functional spec (frozen drafts), `04-implementation-status.md` (**living** status + decision log D1..Dn). Any deviation from 01–03 must be recorded as a new decision in `04`, never by rewriting the drafts.

## Architecture & Data Flow

```
vendor files ──adapter.read()──▶ RuntimeState[] ──buildSnapshot──▶ EnvironmentSnapshot
                                                                      │
        ┌─────────────────────────────┬───────────────────────────────┼───────────────────┐
        ▼                             ▼                               ▼                   ▼
  runDoctor → Finding[]     snapshotToDesiredState → DesiredState   detectDrift      output/text.ts
                                      │  (redacted, portable YAML)    ▲  (read-only)     web/dashboard
                                      ▼                               │
                     buildChangePlan(desired, snapshot) → ChangePlan ──┘ shares diffServer()
                                      │
                       backup → adapter.apply() → audit (MCP servers only, canApply vendors only)
```

- **Adapters** (`src/adapters/`) are the only code that knows vendor formats. Contract in `src/adapters/types.ts`: `read`, `doctor`, `backupTargets`, `apply`, `mcpConfigPath`, `canApply`.
  - Full adapters (`claude-code/index.ts`, `codex/index.ts`) are hand-written, `canApply: true`, and write vendor-native JSON/TOML while preserving unknown fields. `claude-code/plugins.ts` reads the Claude Code plugin registry (`~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`, `enabledPlugins` settings layers) into `PluginPack[]`; MCP servers bundled by enabled plugins get `id: plugin:<name>:<server>` and `managedBy`, and are excluded from export/plan/drift-mcp (the plugin entry is the managed unit).
  - Catalog adapters (`catalog.ts`) are generated from declarative `VendorSpec` entries in `VENDOR_CATALOG`; always `canApply: false` (scan/doctor/drift only).
  - `registry.ts` orders `ALL_ADAPTERS` (codex, claude-code, then catalog) and resolves aliases (`claude`→`claude-code`, `gemini-cli`→`gemini`).
- **Core** (`src/core/`) is vendor-agnostic and pure-ish: `snapshot.ts`, `desired.ts`, `planner/plan.ts`, `drift/drift.ts`, `doctor/doctor.ts`, `storage/*`, `redaction/*`, `version.ts`.
- **CLI** (`src/cli/`) wires commander commands to core; **web** (`src/web/`) serves a read-only loopback dashboard.
- Fault isolation: one adapter throwing becomes a runtime `warnings[]` entry, never a failed scan; adapter `doctor()` exceptions are swallowed after core checks.
- Managed vs observed: only MCP servers on Codex/Claude Code are written by `apply`. Instructions, skills/agents, plugins, config sources, runtime versions, catalog vendors are observed and drift-reported only (drift kinds: `mcp`, `instruction`, `skill`, `plugin`, `runtime-version`). Local servers absent from the profile are never deleted (reported as drift).

## Key Directories

| Path | Purpose |
| --- | --- |
| `src/core/model/types.ts` | Canonical types: `EnvironmentSnapshot`, `RuntimeState`, `McpServer`, `PluginPack`, `DesiredState`, `ChangePlan`, `DriftReport`, `Finding`; `SCHEMA_VERSION` |
| `src/core/storage/` | `paths.ts` (`~/.aem` layout, `~`/`${PROJECT_ROOT}` portability, firmlink normalization), `store.ts` (profiles/snapshots/config + validation + export guard), `backup.ts`, `audit.ts` |
| `src/core/redaction/redact.ts` | Secret detection (`isSecret`, `redactDeep`, `containsSecretLooking`) |
| `src/adapters/shared.ts` | `detectVersion` (cached), `configSource`, `instructionPack`, `skillPacksFromDir`, `normalizeMcpBlock`, `normalizeEnv`, `unknownFields` |
| `src/cli/commands/*.ts` | One `run<Name>` handler per command; `src/cli/common.ts` holds `defaultContext`, `scanNow`, `confirm`, `failWith` |
| `src/output/text.ts` | Pure string renderers (scan/findings/plan/drift), TTY color unless `NO_COLOR` |
| `src/web/server.ts`, `src/web/dashboard.ts` | `GET /`, `GET /api/overview`; dashboard is a single exported HTML template literal, no CDN/build |
| `test/` | `bun:test` suites; `helpers.ts` provides temp-HOME fixtures |
| `_docs/` | Planning drafts + living status doc |

## Development Commands

```bash
npm install            # runs `prepare` → tsc build into dist/
npm run build          # tsc -p tsconfig.json
npm run typecheck      # tsc --noEmit
npm test               # bun test (integration suite builds dist first)
npm run release:pack   # build + npm pack → tarball attached to GitHub Releases
node dist/cli/index.js scan --json        # run the CLI from a checkout
AEM_HOME=/tmp/h AEM_NO_EXEC=1 node dist/cli/index.js doctor
```

Useful env vars: `AEM_HOME` (home override), `AEM_DIR` (store root, default `~/.aem`), `AEM_NO_EXEC=1` (never spawn vendor binaries for `--version`), `NO_COLOR`.

Exit codes: `0` ok · `1` error · `2` doctor error/critical · `3` drift · `4` update available (`update --check`).

## Code Conventions & Common Patterns

- **ESM / NodeNext**: relative imports use the emitted `.js` suffix (`from "../core/model/types.js"`), built-ins use `node:` prefixes, type-only imports use `import type`.
- **Synchronous everywhere**: all fs/config work uses sync `node:fs`; no `async`/`Promise` in core or adapters. Only the CLI entry uses `parseAsync`.
- **Naming**: camelCase functions/locals, PascalCase types, UPPER_CASE constants, named exports only. Canonical refs are dotted: `mcp.<id>`, `instruction.<id>`, `skill.<id>`, `runtime.<id>`. Generated ids are deterministic per run (`finding_01`, `change_01`).
- **Errors**: read paths never throw — push to `warnings: string[]` and continue. Store validation throws `ProfileValidationError` with `code: "schema" | "secret" | "conflict" | "not_found"` via the private `fail()` helper; CLI maps these to `failWith()` (exit 1) with a `Next:` hint. Expected absence returns `undefined`/`[]`.
- **Dependency injection**: adapters and core take an `AdapterContext { home, project, env, allowExec }`; never read `process.env`/`os.homedir()` directly inside adapters or core (tests override `home`).
- **Secrets**: `EnvVarRef` keeps only `source`/`secret`/`present`; a literal `value` is allowed only when non-secret. Desired-state secrets become `{ source: "env", required: true, value: "redacted" }`. `serializeDesiredState()` is the final guard and refuses to write secret-looking YAML. Never compare or print env values, only names.
- **Path portability**: store `~` for home and `${PROJECT_ROOT}` for project paths (including embedded occurrences inside JSON strings); compare in portable space via `portabilize(materialize(v))` so `/var` vs `/private/var` never diff. Project instruction/skill paths are `./`-relative.
- **Vendor fields**: copy the existing MCP block on write so unknown fields survive; unknown read fields go to `raw` after `redactDeep`.
- **Schema artifacts** carry `schemaVersion`, a literal `kind`, and ISO `generatedAt`.
- **Adding a read-only vendor**: append one `VendorSpec` to `VENDOR_CATALOG` in `src/adapters/catalog.ts` (unique `id`, `presence` dirs, `configFiles`, optional `binary`, `mcp` refs with `key`/`style`, `instructions`, `skillsDirs`). Generic binary names must rely on `presence` dirs only (false-positive guard). Add a case to `test/catalog.test.ts`.
- **Promoting to a full adapter**: create `src/adapters/<id>/index.ts` implementing every contract member with `canApply: true`, register it in `ALL_ADAPTERS`, and **remove** its `VendorSpec` (duplicate ids break `selectAdapters`).
- **Adding a CLI command**: `src/cli/commands/<name>.ts` exporting `run<Name>`, register in `src/cli/index.ts` with commander, reuse `common.ts` helpers, then update the README command table.

## Important Files

- `src/cli/index.ts` — CLI entry (`bin: aem` → `dist/cli/index.js`), commander registration.
- `src/adapters/registry.ts` — adapter ordering, aliases, `selectAdapters`.
- `src/adapters/catalog.ts` — the 40+ vendor declarative catalog.
- `src/core/planner/plan.ts` — `buildChangePlan` and `diffServer` (shared by plan and drift; keep them aligned).
- `src/core/storage/store.ts` — `validateDesiredState`, `saveProfile`, `serializeDesiredState` export guard, `loadConfig` (active profile).
- `src/cli/commands/profile.ts` — profile resolution order: `--profile` → `<cwd>/.aem/desired-state.yaml` (project, check-only) → active profile.
- `src/core/version.ts` + `src/cli/commands/update.ts` — self-update from GitHub Releases (`CodeMath/agent-enviorment-manager`); the only networked path.
- `package.json`, `tsconfig.json` — `strict` + `noUncheckedIndexedAccess`, `rootDir: src`, `outDir: dist`, only `dist` is published.
- `README.md` — must stay in sync: command table, vendor table, "What gets managed vs observed", install/version examples.
- `_docs/04-implementation-status.md` — bump release table, tests count, decision log on every behavior change.

## Runtime/Tooling Preferences

- Production runtime: **Node >= 20** (ESM). Do not introduce Bun-only APIs into `src/`.
- Package manager: **npm** (`package-lock.json` v3). No pnpm/yarn lockfiles.
- Tests run under **Bun** (`bun test`); test files may use `bun:test` but exercise the Node-built CLI.
- Runtime deps are intentionally minimal: `commander`, `yaml`, `smol-toml`. Prefer these over new packages.
- No linter/formatter is configured; match the surrounding style (2-space indent, double quotes, trailing commas, ~100-col lines).
- No CI checked in; verification is local (`npm run typecheck && npm test`) plus a real-machine scan/doctor/export/drift pass before a release.
- Local store lives in `~/.aem/` (`config.yaml`, `state/`, `profiles/`, `snapshots/`, `backups/<ts>/<vendor>/…`, `audit/events.jsonl`, `adapters/cache.json`).

## Testing & QA

- Framework: `bun:test`; run `npm test` (or `bun test test/planner.test.ts` for one file). Currently ~57 tests across `adapters`, `catalog`, `integration`, `planner`, `paths`, `redaction`, `version`, `web`.
- Fixtures: `test/helpers.ts` — `makeTempHome()` (mkdtemp), `seedFixtureHome(home)` (Codex TOML + Claude JSON + skills + instructions + `project/`), `seedClaudePlugins(home)` (plugin registry with enabled/disabled/missing/other-repo cases), `ctxFor(home, project?)` (`allowExec: false`, env limited to `PATH`/`HOME`). The fixture plants the secret canary `sk-P2vyt…`; every serialized artifact (state, findings, YAML, HTTP payloads, audit) must assert it is absent.
- Integration (`test/integration.test.ts`) runs `npm run build` in `beforeAll` and executes `node dist/cli/index.js` with `HOME`/`AEM_HOME`=temp, `AEM_NO_EXEC=1`, `NO_COLOR=1`, cwd `<home>/project`; use `{ expectFail: true }` for expected non-zero exits.
- Invariants tests enforce and new code must keep: `apply --dry-run` leaves files byte-identical; real apply creates exactly one backup equal to the pre-apply file and appends an audit event; unknown vendor fields survive apply; export→import round-trips; `materialize(portabilize(v)) === v`; catalog adapters never appear in a `ChangePlan`; project profiles are rejected by `diff`/`apply` but honored by `drift`/`doctor`.
- Patterns: new adapter behavior → seed exact vendor files under a temp home and assert canonical ids/transport/env/skills (`test/adapters.test.ts`, `test/catalog.test.ts`); new drift kind → start from `fixtureWorld()` in `test/planner.test.ts`, prove the baseline is clean, mutate one dimension, assert `kind`/`change`/`resourceRef`/`detail`; new CLI behavior → add an integration case asserting both text and `--json` output.
- Do not add tests for defaults or tautologies; test observable behavior and edge cases (missing install, malformed config → warning, secret redaction).
