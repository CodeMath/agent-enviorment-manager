# Agent Environment Manager 구현 현황

문서 상태: Living document (구현과 함께 갱신)
최종 갱신: 2026-09-04 (v0.6.0 기준)
기준 문서: `01-project-philosophy-and-policy.md`, `02-side-project-roadmap.md`, `03-mvp-functional-spec.md`

이 문서는 계획 문서(01~03)와 실제 구현 사이의 현황·편차·결정 사항을 기록한다. 계획 문서는 작성 시점의 Draft로 보존하고, 변경 이력은 여기에 쌓는다.

## 1. 릴리스 이력

| 버전 | 릴리스 (KST) | 내용 |
| --- | --- | --- |
| v0.1.0 | 2026-09-01 | Local MVP: scan/doctor/export/import/profile/diff/apply/drift + `aem update` |
| v0.2.0 | 2026-09-02 | 벤더 카탈로그 10종 (read-only), 버전 캐시, 동일 id MCP per-runtime 병합 수정 |
| v0.3.0 | 2026-09-02 | 이식 가능한 profile (`~` 임베디드 경로 포함), tokscale 전체 벤더 커버리지 (43종) |
| v0.4.0 | 2026-09-02 | 프로젝트 스코프 profile: `aem init`, scope-aware drift/doctor, `${PROJECT_ROOT}` 변수화 |
| v0.5.0 | 2026-09-03 | `aem web`: read-only 로컬 대시보드 (임베디드 단일 파일 UI, 127.0.0.1 전용) |
| v0.6.0 | 2026-09-04 | Claude Code 플러그인 인벤토리(D10), `aem baseline update`(D11), AGENTS.md |

배포: GitHub Releases에 prebuilt npm tarball 에셋 첨부. 설치/업데이트는 `npm install -g <tarball URL>` 또는 `aem update`.

## 2. 로드맵 대비 현황

### Phase 0 — Foundation Spike: 완료 (Phase 1에 흡수)

canonical model v0(`aem.dev/v0`), adapter interface, 로컬 저장 구조, redaction 패턴을 구현과 동시에 확정했다. fixture는 별도 디렉터리 대신 테스트 코드(`test/helpers.ts`)에 내장.

### Phase 1 — Local MVP: 완료 (v0.1.0)

| 마일스톤 | 상태 |
| --- | --- |
| M0 canonical model v0 | 완료 — EnvironmentSnapshot / DesiredState / McpServer / Finding / ChangePlan / DriftReport |
| M1 Scan MVP | 완료 — 실측 warm scan <0.1s (목표 2s) |
| M2 Doctor MVP | 완료 — 9개 finding category, severity 4단계, suggested action |
| M3 Desired State MVP | 완료 — export/import/diff round-trip, secret guard 3중 방어 |
| M4 Apply MVP | 완료 — 백업 필수, dry-run 무변경 보장(테스트), audit jsonl |
| M5 Drift MVP | 완료 — MCP/instruction/skill/plugin/runtime-version drift |

스펙 16장 "MVP 완료 정의" 전 항목 충족. 테스트 48개(unit / adapter fixture / planner / temp-HOME CLI 통합).

### Phase 2 — Personal Productivity: 부분 완료

| 항목 | 상태 |
| --- | --- |
| `aem init` (프로젝트 desired-state 생성) | 완료 (v0.4.0, 계획 대비 조기 구현) |
| project-specific profile | 완료 — check-only (아래 결정 D4) |
| better diff renderer | 부분 — portable-space 비교로 경로 스펠링 오탐 제거 |
| `aem baseline update` (drift 수용) | 완료 — 결정 D11 |
| `aem status` / `aem drift`(snapshot 대비) / `aem history` | 미구현 |
| profile 템플릿 / shell completion / Homebrew | 미구현 |
| GitHub Actions read-only check | 미구현 (`--json` + exit code 체계는 준비됨) |
| 로컬 대시보드 (`aem web`) | 완료 (v0.5.0, 계획 외 — 결정 D9) |

### Phase 3~5: 미착수

Team baseline(`.aem/team.yaml`)이 다음 단계. 프로젝트 profile(check-only)이 진입로다. 로드맵 원칙대로 Free/Team CLI 검증 전 SaaS 착수 금지.

## 3. 계획 대비 주요 편차·결정

- **D1. `aem update` 추가 (계획 외).** GitHub Releases 확인 + tarball 에셋 self-update. `--check`는 exit 4. 네트워크를 타는 유일한 명령이며 실행 시에만 동작 — local-first 원칙(01 §7) 유지.
- **D2. 벤더 카탈로그 43종 (계획: Claude Code/Codex 2종).** tokscale(junhoyeo/tokscale)의 클라이언트 인벤토리를 기준으로 확장. 선언형 `VendorSpec` 카탈로그로 read-only adapter 자동 생성. apply는 codex/claude-code 전용(`canApply` 플래그). 범용 바이너리명(pi, mux, fx 등)은 오탐 방지를 위해 presence 디렉터리로만 탐지.
- **D3. 경로 이식성 확장.** 스펙(03 §4.3) "absolute path 변수화"를 임베디드 경로(JSON 문자열 내부)까지 적용: 홈 → `~`, 프로젝트 루트 → `${PROJECT_ROOT}`, 프로젝트 instruction/skill → `./` 상대경로. macOS firmlink 스펠링(`/var`↔`/private/var`, `/tmp`↔`/private/tmp`)은 동일 취급하고, diff 비교는 portable space 정규화 후 수행.
- **D4. 프로젝트 profile은 check-only.** 스펙(03 §5) "프로젝트 디렉터리 read-only" 준수: `drift`/`doctor`는 `.aem/desired-state.yaml`을 자동 인식·검증하되 `diff`/`apply`는 명확한 에러로 거부. user/project desired state merge는 Phase 2 후반으로 유지.
- **D5. profile 해석 순서.** `--profile` 명시 → `<cwd>/.aem/desired-state.yaml` → active profile(`aem profile use`).
- **D6. 동일 id MCP의 벤더별 변형 유지.** 정의가 동일할 때만 allowedRuntimes로 병합, 다르면 per-runtime 엔트리 유지 — drift false positive 제거 (v0.2.0에서 실사용 중 발견·수정).
- **D7. 버전 캐시.** `~/.aem/adapters/cache.json`(바이너리 경로+mtime 키). 43종 벤더에서도 warm scan <0.1s. 스펙의 storage layout에 예정돼 있던 파일을 용도 확정.
- **D8. apply 시 미관리 서버 보존.** profile에 없는 로컬 서버는 삭제하지 않고 drift로만 보고 — 파괴적 동작 최소화.
- **D9. 로컬 대시보드는 read-only 뷰어로 허용.** 로드맵의 "웹 대시보드 느게"는 중앙/호스팅 대시보드에 대한 유보로 해석. `aem web`은 127.0.0.1 바인딩, GET 전용, 쓰기 endpoint 없음(변경은 확인·백업·audit이 있는 CLI 전용), 외부 리소스  0(오프라인 동작) 조건으로 local-first 원칙 유지.
- **D10. Claude Code 플러그인은 관리 단위로 인벤토리, check-only.** 스펙(03 §2, §4.8)의 "skill/plugin" 항목 중 플러그인이 누락돼 있었다. `~/.claude/plugins/installed_plugins.json`(v1/v2 레지스트리) + `known_marketplaces.json` + user/project `settings.json`의 `enabledPlugins`를 읽어 `PluginPack`(id `name@marketplace`, version, scope, enabled, marketplaceSource, 구성요소 카운트)으로 정규화한다. 활성 플러그인이 번들한 MCP 서버는 `plugin:<name>:<server>` id와 `managedBy`로 scan/doctor에 노출하되(`${CLAUDE_PLUGIN_ROOT}` 치환) export/plan/drift-mcp 비교에서는 제외 — 플러그인 엔트리가 관리 단위다. DesiredState에 `plugins[]`(파일에서 생략 가능, 기본 `[]`)가 추가됐고 drift는 추가/삭제/enabled/version 변화를 보고하며 설치 힌트(`claude plugin marketplace add` → `claude plugin install`)를 붙인다. doctor는 레지스트리에 있으나 설치 디렉터리가 없는 경우(`broken_path`)와 settings에서 enabled지만 미설치인 경우(`unknown_config`)를 잡는다. 설치는 네트워크·마켓플레이스 신뢰가 필요하므로 벤더 CLI에 맡기고 apply 대상이 아니다(instruction/skill과 동일한 observed 등급). 다른 저장소에 project-scope로 설치된 플러그인은 현재 프로젝트 상태에서 제외한다.
- **D11. `aem baseline update`는 apply의 역방향.** drift가 의도된 변경일 때 "현재 환경을 새 desired state로 수용"하는 명령. 프로필 해석 순서는 drift와 동일(D5). 동작: drift 계산 → 수용될 항목 표시 → 확인(`--yes` 없이 non-TTY면 거부) → 기존 scope/description/createdAt 유지 + `updatedAt` 기록 → 이전 파일을 `~/.aem/backups/<ts>/profiles/`에 백업 → 재-export → audit(수용 항목 목록). 프로젝트 baseline은 `.aem/desired-state.yaml`을 제자리에서 재생성(`init --force`와 동일한 쓰기 권한, D4 범위 내). drift 없으면 no-op. 항목별 선택 수용(partial accept)과 `.aem/ignore.yaml`은 미구현.

## 4. 알려진 한계

- codex `config.toml` apply는 TOML 재직렬화로 주석/포맷이 유실된다(값은 보존, 사전 백업 존재).
- detect-tier 벤더(28종)는 설치 탐지만 제공하며 MCP/instruction 파싱은 없다. 승격은 카탈로그 spec 확장 또는 full adapter 구현으로.
- 플러그인 인벤토리는 Claude Code 전용. Codex 등 다른 벤더의 plugin/extension 체계는 미지원(`plugins: []`).
- 버전 탐지는 `--version` 실행 기반이라 첫 cold scan은 설치된 벤더 수에 비례해 느릴 수 있다(이후 캐시).
- Windows 미지원(스펙 범위 외), Linux는 best-effort.
- doctor autofix 없음(스펙 범위 외, `suggested_action`만 제공).

## 5. 테스트·품질 현황

- 59 tests / 510 assertions: `baseline update` 통합 테스트(no-op, non-TTY 거부, 수용·백업·audit, 프로젝트 baseline 재생성) 포함. Claude Code plugin 레지스트리(enabled 레이어 병합, `${CLAUDE_PLUGIN_ROOT}` 치환, export 제외, plugin drift, doctor finding) 포함. redaction, 경로 이식성(round-trip), adapter fixture(codex/claude/카탈로그), planner(add/update/remove/noop), drift, temp-HOME CLI 통합(export→import→diff→dry-run→apply→drift, 백업 검증, secret guard, 프로젝트 profile 플로우).
- 실환경 검증 절차: 각 릴리스 전 실제 머신에서 scan/doctor/export/diff/drift 수렴 확인, `aem update`로 직전 버전→신규 버전 self-update 확인.
- Golden output test(스펙 14장)는 미도입 — CLI 출력 안정화 후 추가 예정.

## 6. 다음 작업 후보 (우선순위 순)

1. `aem status`(터미널 조종석) / `.aem/ignore.yaml`(finding 억제) / baseline partial accept — 관리 루프 마무리
1. `aem history` (Phase 2 잔여)
2. GitHub Actions read-only check 예제 (`aem drift --json` + exit code 활용)
3. gemini 등 표준 `mcpServers` 벤더의 apply 승격 (가장 저비용 확장)
4. Homebrew tap / shell completion
5. `.aem/team.yaml` + `aem check --team` (Phase 3 진입)
