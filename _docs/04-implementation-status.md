# Agent Environment Manager 구현 현황

문서 상태: Living document (구현과 함께 갱신)
최종 갱신: 2026-09-02 (v0.4.0 기준)
기준 문서: `01-project-philosophy-and-policy.md`, `02-side-project-roadmap.md`, `03-mvp-functional-spec.md`

이 문서는 계획 문서(01~03)와 실제 구현 사이의 현황·편차·결정 사항을 기록한다. 계획 문서는 작성 시점의 Draft로 보존하고, 변경 이력은 여기에 쌓는다.

## 1. 릴리스 이력

| 버전 | 릴리스 (KST) | 내용 |
| --- | --- | --- |
| v0.1.0 | 2026-09-01 | Local MVP: scan/doctor/export/import/profile/diff/apply/drift + `aem update` |
| v0.2.0 | 2026-09-02 | 벤더 카탈로그 10종 (read-only), 버전 캐시, 동일 id MCP per-runtime 병합 수정 |
| v0.3.0 | 2026-09-02 | 이식 가능한 profile (`~` 임베디드 경로 포함), tokscale 전체 벤더 커버리지 (43종) |
| v0.4.0 | 2026-09-02 | 프로젝트 스코프 profile: `aem init`, scope-aware drift/doctor, `${PROJECT_ROOT}` 변수화 |

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
| M5 Drift MVP | 완료 — MCP/instruction/skill/runtime-version drift |

스펙 16장 "MVP 완료 정의" 전 항목 충족. 테스트 48개(unit / adapter fixture / planner / temp-HOME CLI 통합).

### Phase 2 — Personal Productivity: 부분 완료

| 항목 | 상태 |
| --- | --- |
| `aem init` (프로젝트 desired-state 생성) | 완료 (v0.4.0, 계획 대비 조기 구현) |
| project-specific profile | 완료 — check-only (아래 결정 D4) |
| better diff renderer | 부분 — portable-space 비교로 경로 스펠링 오탐 제거 |
| `aem status` / `aem drift`(snapshot 대비) / `aem history` | 미구현 |
| profile 템플릿 / shell completion / Homebrew | 미구현 |
| GitHub Actions read-only check | 미구현 (`--json` + exit code 체계는 준비됨) |

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

## 4. 알려진 한계

- codex `config.toml` apply는 TOML 재직렬화로 주석/포맷이 유실된다(값은 보존, 사전 백업 존재).
- detect-tier 벤더(28종)는 설치 탐지만 제공하며 MCP/instruction 파싱은 없다. 승격은 카탈로그 spec 확장 또는 full adapter 구현으로.
- 버전 탐지는 `--version` 실행 기반이라 첫 cold scan은 설치된 벤더 수에 비례해 느릴 수 있다(이후 캐시).
- Windows 미지원(스펙 범위 외), Linux는 best-effort.
- doctor autofix 없음(스펙 범위 외, `suggested_action`만 제공).

## 5. 테스트·품질 현황

- 48 tests / 430 assertions: redaction, 경로 이식성(round-trip), adapter fixture(codex/claude/카탈로그), planner(add/update/remove/noop), drift, temp-HOME CLI 통합(export→import→diff→dry-run→apply→drift, 백업 검증, secret guard, 프로젝트 profile 플로우).
- 실환경 검증 절차: 각 릴리스 전 실제 머신에서 scan/doctor/export/diff/drift 수렴 확인, `aem update`로 직전 버전→신규 버전 self-update 확인.
- Golden output test(스펙 14장)는 미도입 — CLI 출력 안정화 후 추가 예정.

## 6. 다음 작업 후보 (우선순위 순)

1. `aem status` / `aem history` (Phase 2 잔여)
2. GitHub Actions read-only check 예제 (`aem drift --json` + exit code 활용)
3. gemini 등 표준 `mcpServers` 벤더의 apply 승격 (가장 저비용 확장)
4. Homebrew tap / shell completion
5. `.aem/team.yaml` + `aem check --team` (Phase 3 진입)
