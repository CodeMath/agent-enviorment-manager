# Agent Environment Manager MVP 기능 명세서

문서 상태: Draft v0.1  
작성일: 2026-09-01  
대상: 백엔드 엔지니어, CLI 개발자  
MVP 범위: 개인 무료 로컬 CLI

## 1. MVP 목적

MVP의 목적은 개인 개발자가 자기 로컬 AI 에이전트 환경을 한 번에 이해하고, 재현 가능한 desired state로 저장하고, 변경 전 diff를 확인한 뒤 안전하게 적용할 수 있게 하는 것이다.

MVP는 중앙 Registry, SaaS, 팀 관리, approval workflow를 만들지 않는다. 단, 나중에 AWS Agent Registry 같은 중앙 catalog/governance 계층과 연결할 수 있도록 canonical model과 adapter interface를 처음부터 분리한다.

## 2. 우선 지원 대상

### 2.1 1차 지원

- Claude Code
- Codex

### 2.2 탐지 대상

- agent runtime 설치 여부
- runtime version
- user-level config
- project-level config
- MCP server 설정
- instruction/rule 파일
- skill/plugin 디렉터리
- permission/sandbox 관련 설정
- profile 또는 preset 개념이 있는 경우 해당 설정
- 관련 환경변수 존재 여부

### 2.3 운영체제

MVP 필수:

- macOS

MVP best-effort:

- Linux

MVP 제외:

- Windows native path 지원
- WSL 특수 처리

## 3. MVP 핵심 사용자 흐름

### 3.1 현재 환경 확인

```bash
aem scan
```

사용자는 현재 설치된 Claude Code/Codex, MCP 서버, instruction, skill, config source를 요약해서 볼 수 있다.

### 3.2 문제 진단

```bash
aem doctor
```

사용자는 위험한 MCP 설정, 누락된 env var, 중복 instruction, 깨진 경로, 알 수 없는 config format 등을 확인할 수 있다.

### 3.3 현재 상태를 profile로 저장

```bash
aem export --profile personal-default --out ~/.aem/profiles/personal-default.yaml
```

현재 환경을 redacted desired state로 저장한다.

### 3.4 profile 불러오기

```bash
aem import ~/.aem/profiles/personal-default.yaml
```

profile 파일을 local store에 등록한다.

### 3.5 변경 계획 확인

```bash
aem diff --profile personal-default
aem apply --profile personal-default --dry-run
```

사용자는 어떤 파일이 어떻게 바뀔지 확인한다.

### 3.6 안전 적용

```bash
aem apply --profile personal-default
```

도구는 백업을 만든 뒤 vendor-native config에 변경을 적용한다.

### 3.7 drift 확인

```bash
aem drift --profile personal-default
```

사용자는 현재 환경이 저장된 profile과 달라졌는지 확인한다.

## 4. 기능 범위

### 4.1 Scan

명령:

```bash
aem scan [--json] [--vendor claude|codex|all] [--project <path>]
```

요구사항:

- 설치된 runtime 목록 출력
- runtime version 출력
- 탐지한 config source 목록 출력
- MCP server 목록 출력
- instruction/rule/skill 목록 출력
- secret 값은 출력하지 않음
- 사람이 읽는 table/text와 machine-readable JSON 모두 지원

출력 예:

```text
Agent Environment

Runtimes
- codex: installed, version 0.x.x
- claude-code: installed, version 1.x.x

MCP Servers
- github: codex, enabled, env refs: GITHUB_TOKEN
- postgres-local: claude-code, enabled, command: node server.js

Instructions
- /repo/AGENTS.md
- ~/.codex/skills
```

### 4.2 Doctor

명령:

```bash
aem doctor [--json] [--vendor claude|codex|all] [--profile <name>]
```

MVP finding category:

- `missing_env`: 필요한 환경변수가 없음
- `secret_inline`: config에 secret 값이 직접 들어간 것으로 보임
- `broken_path`: command/path가 존재하지 않음
- `duplicate_mcp`: 같은 MCP server가 여러 vendor에 중복 정의됨
- `dangerous_command`: shell command MCP가 과도한 권한을 가짐
- `unknown_config`: 파싱하지 못한 config block 존재
- `stale_profile`: profile schema version이 오래됨
- `drift_detected`: desired state와 현재 상태가 다름
- `unsupported_version`: vendor config 버전이 adapter 지원 범위 밖임

Finding severity:

- `info`
- `warning`
- `error`
- `critical`

Doctor는 MVP에서 자동 수정하지 않는다. 단, `suggested_action`을 제공한다.

### 4.3 Export

명령:

```bash
aem export --profile <name> --out <path> [--vendor claude|codex|all]
```

요구사항:

- current state를 desired state YAML로 저장
- secret 값은 redaction
- machine-specific absolute path는 가능한 경우 변수화
- export 파일에 schema version 포함
- vendor-native 원본 파일을 그대로 덤프하지 않음

### 4.4 Import

명령:

```bash
aem import <path> [--name <profile-name>]
```

요구사항:

- YAML/JSON desired state profile을 local store에 등록
- schema validation 수행
- 지원하지 않는 schema version이면 명확히 실패
- secret 값이 들어 있으면 경고 또는 실패
- 기존 profile과 이름 충돌 시 `--force` 없이는 실패

### 4.5 Profile

명령:

```bash
aem profile list
aem profile show <name>
aem profile use <name>
aem profile delete <name>
```

MVP profile 의미:

- desired state의 이름 붙은 묶음
- user-level 적용 대상
- project별 자동 적용은 MVP에서 제외

### 4.6 Diff

명령:

```bash
aem diff --profile <name> [--vendor claude|codex|all] [--json]
```

요구사항:

- current state와 desired state 비교
- vendor-native file 변경 계획 표시
- add/update/remove/no-op 구분
- secret 값은 diff에 표시하지 않음
- apply와 동일한 planning engine 사용

### 4.7 Apply

명령:

```bash
aem apply --profile <name> [--vendor claude|codex|all] [--dry-run] [--yes]
```

요구사항:

- 기본적으로 사용자 확인을 요구한다
- `--dry-run`은 파일을 변경하지 않는다
- `--yes`가 있을 때만 non-interactive 적용 가능
- 변경 전 백업 생성
- 적용 결과를 local audit log에 기록
- unknown field는 가능한 경우 보존
- adapter가 자신 있게 적용할 수 없는 변경은 실패 처리

백업 위치:

```text
~/.aem/backups/<timestamp>/<vendor>/<relative-config-path>
```

### 4.8 Drift Detection

명령:

```bash
aem drift --profile <name> [--json]
```

MVP drift 범위:

- MCP server 추가/삭제/변경
- instruction file 추가/삭제/변경 감지
- skill/plugin 추가/삭제 감지
- runtime version 변경 감지
- config source 추가/삭제 감지

MVP 제외:

- 파일 본문 semantic diff
- 실행 로그 기반 drift
- 중앙 정책 대비 drift

## 5. 로컬 저장 구조

기본 디렉터리:

```text
~/.aem/
  config.yaml
  state/
    current.json
    last-scan.json
  profiles/
    personal-default.yaml
  snapshots/
    2026-09-01T10-00-00Z.json
  backups/
    2026-09-01T10-05-00Z/
      codex/
      claude-code/
  audit/
    events.jsonl
  adapters/
    cache.json
```

프로젝트 디렉터리:

```text
<repo>/.aem/
  desired-state.yaml
  ignore.yaml
```

MVP에서는 프로젝트 디렉터리 지원을 read-only로 제한한다. `aem init`과 team baseline은 Phase 2~3로 미룬다.

## 6. Canonical Data Model v0

### 6.1 EnvironmentSnapshot

```yaml
schemaVersion: aem.dev/v0
kind: EnvironmentSnapshot
generatedAt: "2026-09-01T00:00:00Z"
host:
  os: darwin
  arch: arm64
  hostnameHash: "sha256:..."
runtimes:
  - id: codex
    name: Codex
    installed: true
    version: "0.x.x"
    adapterVersion: "0.1.0"
    configSources:
      - id: codex-user-config
        scope: user
        path: "~/.codex/config.toml"
        format: toml
        readable: true
    mcpServers: []
    instructionPacks: []
    skillPacks: []
findings: []
```

### 6.2 DesiredState

```yaml
schemaVersion: aem.dev/v0
kind: DesiredState
metadata:
  name: personal-default
  description: Personal default agent environment
  createdAt: "2026-09-01T00:00:00Z"
targets:
  runtimes:
    - id: codex
      enabled: true
    - id: claude-code
      enabled: true
mcpServers:
  - id: github
    displayName: GitHub
    enabled: true
    allowedRuntimes: [codex, claude-code]
    transport: stdio
    command:
      executable: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN:
        source: env
        required: true
        value: redacted
instructions:
  - id: repo-agents
    type: project
    path: "./AGENTS.md"
    applyTo: [codex]
skills:
  - id: imagegen
    type: local
    applyTo: [codex]
policies:
  secretHandling: forbid-inline
  unknownFields: preserve
```

### 6.3 McpServer

```yaml
id: github
displayName: GitHub
vendorRefs:
  codex: github
  claude-code: github
enabled: true
transport: stdio
command:
  executable: npx
  args: ["-y", "@modelcontextprotocol/server-github"]
env:
  GITHUB_TOKEN:
    source: env
    required: true
capabilities:
  tools: unknown
security:
  networkAccess: unknown
  filesystemAccess: unknown
  risk: warning
```

### 6.4 Finding

```yaml
id: finding_01
severity: warning
category: missing_env
title: Missing GITHUB_TOKEN
message: GitHub MCP server requires GITHUB_TOKEN but it is not present in the environment.
runtime: codex
resourceRef: mcp.github
suggestedAction: Set GITHUB_TOKEN in your shell environment or disable this MCP server.
```

### 6.5 ChangePlan

```yaml
schemaVersion: aem.dev/v0
kind: ChangePlan
profile: personal-default
generatedAt: "2026-09-01T00:00:00Z"
changes:
  - id: change_01
    runtime: codex
    action: update
    targetPath: "~/.codex/config.toml"
    summary: Add github MCP server
    risk: low
    backupRequired: true
```

## 7. Adapter Interface

언어는 구현체에 따라 달라질 수 있지만, 인터페이스는 다음 개념을 유지한다.

```ts
interface AgentRuntimeAdapter {
  id: string;
  displayName: string;
  supportedPlatforms: Platform[];
  discover(ctx: DiscoverContext): Promise<RuntimeDiscovery>;
  read(ctx: ReadContext, discovery: RuntimeDiscovery): Promise<RuntimeState>;
  doctor(ctx: DoctorContext, state: RuntimeState): Promise<Finding[]>;
  plan(ctx: PlanContext, desired: DesiredState, current: RuntimeState): Promise<AdapterChangePlan>;
  apply(ctx: ApplyContext, plan: AdapterChangePlan): Promise<ApplyResult>;
  render(ctx: RenderContext, desired: DesiredState): Promise<RenderedConfig[]>;
}
```

Adapter 규칙:

- adapter는 secret 값을 반환하지 않는다
- adapter는 parsing 불가 영역을 `unknown` metadata로 보존한다
- adapter는 파일 변경 전 backup 대상 목록을 제공한다
- adapter는 자신 없는 변경을 partial apply하지 않는다
- adapter별 fixture test를 필수로 둔다

## 8. CLI UX 원칙

### 8.1 기본 출력

- 기본은 사람이 읽기 쉬운 텍스트
- `--json`을 주면 자동화 가능한 JSON
- 위험 finding은 색상/심각도 표시
- dry-run 결과는 실제 apply와 같은 change plan 기반

### 8.2 실패 메시지

실패 메시지는 다음 구조를 가진다.

```text
Error: Cannot apply profile "personal-default"
Reason: Codex adapter found an unsupported config block in ~/.codex/config.toml
Next: Run `aem doctor --vendor codex` and update the adapter or remove the unsupported block.
```

### 8.3 Non-interactive Mode

CI나 script에서는 다음 조합을 사용한다.

```bash
aem doctor --json
aem diff --profile personal-default --json
aem apply --profile personal-default --yes
```

## 9. 비기능 요구사항

### 9.1 안전성

- `scan`, `doctor`, `diff`, `drift`는 파일을 변경하지 않는다
- `apply`는 백업 없이는 vendor config를 변경하지 않는다
- `--dry-run`은 절대 파일을 변경하지 않는다
- secret-looking value는 stdout, JSON, file export에서 redaction한다

### 9.2 성능

- 일반 로컬 환경에서 `aem scan`은 2초 이내 목표
- `aem doctor`는 3초 이내 목표
- 네트워크 호출은 MVP 기본 경로에 포함하지 않는다
- 대용량 디렉터리 재귀 탐색을 피한다

### 9.3 신뢰성

- config parser는 unknown field를 보존한다
- adapter failure는 다른 adapter scan을 막지 않는다
- partial result는 warning과 함께 출력한다
- snapshot과 audit log는 append-only에 가깝게 관리한다

### 9.4 호환성

- macOS arm64/x64 지원
- Linux x64 best-effort
- shell은 zsh/bash 환경변수 탐지 best-effort
- vendor version이 unknown이면 read-only 모드로 degrade

### 9.5 보안/프라이버시

- 기본 텔레메트리 없음
- 계정/로그인 없음
- secret value 저장 금지
- export 파일에 hostname 원문 저장 금지
- path는 필요한 경우 `~`, `$HOME`, project root로 축약

## 10. MVP 제외 범위

- 웹 UI
- SaaS backend
- 팀 계정
- SSO/RBAC
- approval workflow
- 중앙 Registry sync
- AWS Agent Registry write integration
- 실시간 runtime enforcement
- agent execution log 수집
- session replay
- token/cost 분석
- MCP server marketplace
- secret vault 구현
- Windows native 지원
- 자동 dependency 설치
- doctor autofix
- IDE extension

## 11. 구현 모듈 제안

```text
src/
  cli/
    index.ts
    commands/
      scan.ts
      doctor.ts
      export.ts
      import.ts
      profile.ts
      diff.ts
      apply.ts
      drift.ts
  core/
    model/
    schema/
    planner/
    diff/
    redaction/
    storage/
    audit/
  adapters/
    codex/
    claude-code/
  output/
    text.ts
    json.ts
  test/
    fixtures/
```

언어/런타임은 팀 선호에 따라 선택할 수 있으나, MVP는 CLI 배포와 config 파싱이 쉬운 스택을 우선한다. TypeScript(Node) 또는 Rust가 적합하다.

TypeScript 장점:

- JSON/YAML/TOML 파싱 생태계 풍부
- CLI 개발 속도 빠름
- MCP 생태계와 친화적

Rust 장점:

- 단일 바이너리 배포 쉬움
- 파일 처리 안정성
- 성능과 타입 안정성

사이드프로젝트 MVP라면 TypeScript로 빠르게 검증하고, 배포/성능 요구가 커질 때 Rust 전환 또는 핵심 모듈 Rust화를 검토한다.

## 12. Acceptance Criteria

### 12.1 Scan

- Claude Code/Codex 설치 여부를 탐지한다
- 최소 user-level config source를 표시한다
- MCP server를 canonical model로 출력한다
- `--json` 출력이 schema validation을 통과한다

### 12.2 Doctor

- inline secret 의심 값을 warning 이상으로 표시한다
- missing env var를 표시한다
- broken path를 표시한다
- unsupported config는 명확한 finding으로 표시한다
- adapter 하나가 실패해도 전체 doctor가 종료되지 않는다

### 12.3 Export/Import

- export 파일에 secret value가 포함되지 않는다
- export한 profile을 import할 수 있다
- import한 profile로 diff를 실행할 수 있다
- schema version mismatch를 감지한다

### 12.4 Diff/Apply

- diff와 dry-run apply가 같은 change plan을 출력한다
- apply 전 백업이 생성된다
- apply 후 scan 결과가 desired state와 일치한다
- apply 실패 시 어떤 파일이 변경되었는지 audit log에 남는다
- `--dry-run`은 파일 변경이 없음을 테스트로 보장한다

### 12.5 Drift

- profile 대비 MCP server 추가/삭제/변경을 감지한다
- instruction/skill 추가/삭제를 감지한다
- runtime version 변경을 감지한다
- drift 결과를 JSON으로 출력할 수 있다

## 13. MVP 개발 순서

1. JSON/YAML schema와 TypeScript/Rust type 정의
2. local storage 모듈 구현
3. redaction 모듈 구현
4. adapter interface 정의
5. Codex read-only adapter 구현
6. Claude Code read-only adapter 구현
7. `scan` 구현
8. `doctor` 구현
9. `export/import` 구현
10. planner/diff 구현
11. safe backup 구현
12. `apply --dry-run` 구현
13. `apply` 구현
14. drift detection 구현
15. fixture와 regression test 보강

## 14. 테스트 전략

### Unit Test

- schema validation
- redaction
- path normalization
- parser
- diff planner
- finding generation

### Fixture Test

- Codex config fixture
- Claude Code config fixture
- MCP server variants
- missing env case
- inline secret case
- unknown field preservation

### Integration Test

- temporary HOME에서 scan/export/import/diff/apply round-trip
- apply backup 생성 확인
- dry-run no-write 확인
- adapter failure isolation 확인

### Golden Output Test

- `aem scan`
- `aem doctor`
- `aem diff`
- `aem drift`

출력 형식이 CLI UX의 핵심이므로 golden file test를 둔다.

## 15. 첫 번째 개발 티켓 묶음

### Ticket 1 - Project Scaffold

- CLI entrypoint 생성
- command parser 선택
- test runner 설정
- lint/typecheck 설정

### Ticket 2 - Schema v0

- `EnvironmentSnapshot`
- `DesiredState`
- `McpServer`
- `Finding`
- `ChangePlan`

### Ticket 3 - Local Storage

- `~/.aem` 디렉터리 생성
- profile 저장/조회
- snapshot 저장
- audit jsonl append

### Ticket 4 - Redaction

- env/token/key/password 패턴 redaction
- export guard
- stdout guard 테스트

### Ticket 5 - Codex Adapter Read-only

- 설치 여부 탐지
- user config 탐지
- project instruction 탐지
- MCP config 탐지

### Ticket 6 - Claude Code Adapter Read-only

- 설치 여부 탐지
- config source 탐지
- MCP config 탐지
- instruction/rule 탐지

### Ticket 7 - Scan Command

- text output
- json output
- partial adapter failure 처리

### Ticket 8 - Doctor Command

- finding taxonomy 구현
- severity 출력
- suggested action 출력

### Ticket 9 - Export/Import/Profile

- profile YAML 저장
- schema validation
- profile list/show/use

### Ticket 10 - Diff/Apply

- change plan 생성
- dry-run 출력
- backup 후 apply
- audit log 기록

### Ticket 11 - Drift

- profile 대비 current state 비교
- JSON/text output

## 16. MVP 완료 정의

MVP는 다음이 모두 가능할 때 완료로 본다.

- fresh macOS에서 CLI 설치 후 `aem scan` 실행 가능
- Claude Code/Codex 환경을 최소 read-only로 탐지 가능
- MCP/instruction/skill/config source가 canonical model에 들어감
- `aem doctor`가 실제로 유용한 finding을 출력함
- `aem export -> aem import -> aem diff -> aem apply --dry-run` 흐름이 동작함
- `aem apply`가 백업을 남기고 설정을 적용함
- `aem drift`가 profile 대비 변경을 감지함
- secret value가 export/stdout/audit에 남지 않음을 테스트로 검증함
- 모든 핵심 명령에 fixture/integration test가 있음
