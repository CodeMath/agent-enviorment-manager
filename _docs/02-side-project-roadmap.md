# Agent Environment Manager 전체 사이드프로젝트 로드맵

문서 상태: Draft v0.1  
작성일: 2026-09-01  
대상: 초기 개발팀, 백엔드 엔지니어, 플랫폼 엔지니어

## 1. 로드맵 개요

Agent Environment Manager는 중앙 Registry와 직접 경쟁하지 않는다. 제품의 중심은 개발자 로컬 환경의 desired state 관리, vendor-native config 변환, drift detection, safe apply다.

전체 로드맵은 다음 6개 Phase로 나눈다.

| Phase | 이름 | 제품 단계 | 핵심 질문 |
| --- | --- | --- | --- |
| Phase 0 | Foundation Spike | 설계/검증 | 이 문제를 안정적인 canonical model과 adapter 구조로 풀 수 있는가 |
| Phase 1 | Local MVP | 개인 무료 | Claude Code/Codex 환경을 탐지하고 desired state로 관리할 수 있는가 |
| Phase 2 | Personal Productivity | 개인 확장 | profile, import/export, doctor가 매일 쓸 만큼 편한가 |
| Phase 3 | Team Baseline | 팀 | 팀 표준 환경을 git/CI로 공유하고 drift를 줄일 수 있는가 |
| Phase 4 | Governance Connectors | 팀/엔터프라이즈 진입 | Registry, policy, approval 시스템과 연결할 수 있는가 |
| Phase 5 | Enterprise Control Plane | 엔터프라이즈 | 조직 전체 agent environment를 관리/감사할 수 있는가 |

## 2. Phase 0 - Foundation Spike

### 목표

MVP 구현 전에 canonical model, adapter interface, 로컬 저장 구조, 위험 모델을 검증한다.

### 핵심 기능

- Claude Code/Codex 설정 위치 조사
- MCP 설정 패턴 조사
- `AgentRuntime`, `McpServer`, `InstructionPack`, `SkillPack`, `Profile`, `DesiredState`, `Finding` 초안 schema 작성
- adapter interface 초안 작성
- sample fixture 기반 parser prototype
- CLI 명령 구조 초안 작성

### 기술 과제

- vendor별 설정 파일 위치와 형식 차이
- user-level config와 project-level config의 우선순위
- unknown field 보존 전략
- secret redaction 패턴
- local backup/rollback 방식
- YAML/JSON schema 선택

### 산출물

- `docs/model.md`
- `docs/adapter-interface.md`
- `docs/storage-layout.md`
- `fixtures/claude-code/*`
- `fixtures/codex/*`
- `aem scan --fixture` prototype

### 진입 기준

- 제품 문제와 MVP 범위가 합의되어 있다
- 우선 지원 vendor가 Claude Code/Codex로 확정되어 있다
- 관찰/수집 영역은 외부 adapter 연계로 미룬다는 원칙이 정해져 있다

### 종료 기준

- canonical model v0가 문서화되어 있다
- Claude Code/Codex fixture를 canonical model로 변환할 수 있다
- MVP에서 제외할 영역이 명확하다
- apply safety 원칙이 정해져 있다

### 주요 리스크

- vendor config 구조가 빠르게 바뀔 수 있다
- 비공식 설정 경로 의존이 커질 수 있다
- canonical model이 너무 추상적이면 MVP 구현이 느려진다
- 너무 vendor-specific이면 Team/Enterprise 확장이 어렵다

## 3. Phase 1 - Local MVP

### 목표

개인 개발자가 로컬에서 Claude Code/Codex 환경을 scan, doctor, export/import, diff, apply할 수 있는 최소 CLI를 만든다.

### 핵심 기능

- `aem scan`
- `aem doctor`
- `aem export`
- `aem import`
- `aem profile list/use`
- `aem diff`
- `aem apply --dry-run`
- `aem apply`
- Claude Code adapter v0
- Codex adapter v0
- MCP server 탐지/정규화
- instruction/skill/profile 탐지
- local drift detection v0

### 기술 과제

- macOS/Linux 경로 처리
- 설정 파일 파싱과 unknown field 보존
- dry-run diff 품질
- backup 생성과 실패 처리
- secret redaction 정확도
- adapter 테스트 fixture 확보
- CLI UX 단순화

### 산출물

- install 가능한 CLI binary 또는 npm/pip/cargo package
- `~/.aem/state/current.json`
- `~/.aem/profiles/*.yaml`
- JSON Schema
- CLI help 문서
- 최소 테스트 세트
- example profile 2개

### 진입 기준

- Phase 0 model과 adapter interface가 확정되어 있다
- 최소 fixture가 준비되어 있다
- MVP 제외 범위가 문서화되어 있다

### 종료 기준

- fresh machine 기준 5분 안에 scan 가능
- Claude Code/Codex 중 최소 둘 다 설치 여부 탐지 가능
- MCP 서버 목록을 canonical model로 출력 가능
- doctor가 최소 8개 이상의 의미 있는 finding을 낼 수 있음
- dry-run과 apply가 같은 change plan을 공유함
- apply 전 백업 생성
- export/import round-trip 테스트 통과

### 주요 리스크

- 실제 사용자 환경이 fixture보다 훨씬 다양할 수 있다
- apply가 사용자의 기존 설정을 망가뜨릴 수 있다
- secret redaction 누락은 신뢰를 크게 훼손한다
- Codex/Claude config가 버전별로 다를 수 있다

## 4. Phase 2 - Personal Productivity

### 목표

MVP를 "한 번 써보는 도구"에서 "개인 개발자가 계속 쓰는 도구"로 만든다.

### 핵심 기능

- profile 템플릿
- project-specific profile
- `aem init`로 프로젝트 `.aem/desired-state.yaml` 생성
- `aem status`로 현재 상태 요약
- `aem drift`로 이전 snapshot 대비 변경 감지
- better diff renderer
- doctor autofix 제안
- local history
- shell completion
- Homebrew 또는 installer 제공
- GitHub Actions용 read-only check

### 기술 과제

- user-level/project-level desired state merge
- profile inheritance
- drift baseline 관리
- 사람이 읽기 좋은 diff와 machine-readable diff 동시 제공
- cross-platform path abstraction
- noisy finding 억제

### 산출물

- `aem init`
- `aem status`
- `aem drift`
- `aem history`
- profile template catalog
- GitHub Actions example
- getting started guide

### 진입 기준

- Phase 1 CLI가 실제 로컬 환경에서 동작한다
- 초기 사용자 피드백 5명 이상 확보
- 가장 흔한 parsing/apply 오류가 파악되어 있다

### 종료 기준

- 개인 profile 3개 이상을 안정적으로 전환 가능
- project desired state와 user profile merge 가능
- drift detection 결과가 false positive 과다 없이 유용함
- GitHub Actions에서 `aem check` 가능
- installer로 비개발 환경에서도 설치 가능

### 주요 리스크

- profile merge 규칙이 복잡해질 수 있다
- doctor finding이 많아져 사용자가 무시할 수 있다
- 개인용 기능이 상용 Team 기능과 경계가 흐려질 수 있다

## 5. Phase 3 - Team Baseline

### 목표

팀이 저장소에 표준 agent environment baseline을 선언하고, 개발자 로컬/CI에서 drift를 검증할 수 있게 한다.

### 핵심 기능

- team baseline file: `.aem/team.yaml`
- role-based profile: `backend`, `frontend`, `data`, `security`
- policy lint
- CI check mode
- PR comment용 JSON/SARIF output
- team-approved MCP allowlist/blocklist
- instruction baseline validation
- shared adapter version lock
- baseline migration tool

### 기술 과제

- 개인 설정과 팀 baseline 충돌 해결
- policy severity 설계
- 예외 처리 방식
- CI에서 secret 없이 검증하는 방법
- monorepo에서 경로별 profile 적용
- 팀 baseline schema migration

### 산출물

- `.aem/team.yaml` schema
- `aem check --team`
- `aem policy lint`
- `aem baseline update`
- CI templates
- sample team repository
- Team policy guide

### 진입 기준

- 개인용 profile과 drift detection이 안정적이다
- 최소 2개 이상의 실제 프로젝트에서 `.aem/desired-state.yaml` 사용 경험이 있다
- 정책 finding taxonomy가 정리되어 있다

### 종료 기준

- 팀 baseline으로 신규 개발자 환경 bootstrap 가능
- CI에서 팀 표준 위반을 검출 가능
- allowlist/blocklist 기반 MCP 검증 가능
- role별 profile 적용 가능
- baseline 변경이 review 가능한 diff로 표현됨

### 주요 리스크

- 정책이 너무 강하면 개발자 경험이 나빠진다
- 팀별 예외가 많아지면 schema가 복잡해진다
- CI check가 실제 로컬 환경과 괴리될 수 있다

## 6. Phase 4 - Governance Connectors

### 목표

외부 Registry, ID, ticketing, approval 시스템과 연결할 수 있는 connector 구조를 만든다.

### 핵심 기능

- Registry connector interface
- AWS Agent Registry read connector
- internal registry mock connector
- approval reference model
- policy bundle sync
- signed baseline
- audit event export
- Jira/ServiceNow style approval URL reference
- organization namespace

### 기술 과제

- 중앙 Registry resource와 local desired state 매핑
- signed policy/baseline 검증
- connector credential 처리
- offline mode와 online sync의 일관성
- external approval state caching
- 중앙 정책과 local override 충돌 처리

### 산출물

- `aem registry sync`
- `aem policy sync`
- `aem audit export`
- connector SDK
- AWS Agent Registry mapping doc
- signed baseline spec
- enterprise connector examples

### 진입 기준

- 팀 baseline 사용 사례가 검증되어 있다
- canonical model이 Registry resource와 매핑 가능한 수준으로 안정적이다
- 상용 사용자 후보가 중앙 governance 연계를 요구한다

### 종료 기준

- 외부 Registry에서 approved MCP/tool/skill metadata를 가져올 수 있다
- 가져온 resource를 local desired state로 변환 가능
- signed baseline 검증 가능
- audit event를 외부 시스템으로 export 가능
- connector credential이 secret redaction 원칙을 지킨다

### 주요 리스크

- AWS/외부 Registry API 변화
- connector별 인증 방식 차이
- 중앙 승인 상태와 로컬 적용 상태의 race condition
- Enterprise 요구가 제품을 지나치게 무겁게 만들 수 있다

## 7. Phase 5 - Enterprise Control Plane

### 목표

조직 전체 개발자 agent environment의 inventory, drift, policy compliance, audit을 관리하는 상용 control plane을 제공한다.

### 핵심 기능

- hosted admin console
- SSO/RBAC
- org/project/team hierarchy
- fleet inventory
- compliance dashboard
- policy assignment
- exception workflow
- audit log retention
- endpoint report ingestion
- managed profile distribution
- enterprise connectors
- SIEM export

### 기술 과제

- 멀티테넌트 데이터 모델
- endpoint identity
- 개인정보 최소화와 조직 감사 요구의 균형
- event ingestion scale
- RBAC와 policy inheritance
- audit immutability
- admin UX
- enterprise deployment 옵션

### 산출물

- SaaS control plane
- local agent/CLI enrollment
- admin policy UI
- dashboard
- SSO integration
- audit export
- enterprise documentation
- security whitepaper

### 진입 기준

- Team 제품에서 반복 사용과 지불 의사가 확인되어 있다
- 최소 2개 이상의 enterprise design partner가 있다
- connector와 audit model이 검증되어 있다

### 종료 기준

- 조직 단위 inventory와 drift 상태 확인 가능
- 정책 적용 대상과 예외 승인 관리 가능
- 감사 로그 export 가능
- Registry connector와 local CLI가 end-to-end로 동작
- 보안/개인정보 리뷰 문서화

### 주요 리스크

- endpoint management 경쟁 영역으로 확장될 수 있다
- 보안팀 요구와 개발자 경험이 충돌할 수 있다
- 너무 빨리 SaaS화하면 개인/팀 CLI 품질이 흔들릴 수 있다
- enterprise sales cycle이 사이드프로젝트 속도와 맞지 않을 수 있다

## 8. Phase별 우선순위 원칙

### 먼저 해야 할 것

- 정확한 scan
- 안전한 dry-run/apply
- 사람이 이해 가능한 diff
- secret redaction
- fixture 기반 adapter 테스트
- canonical model 안정화

### 늦게 해야 할 것

- 웹 대시보드
- 중앙 서버
- SSO/RBAC
- 실시간 에이전트 실행 차단
- 로그 replay
- marketplace
- 복잡한 approval workflow

## 9. 릴리스 전략

### Alpha

- 대상: 본인과 가까운 개발자 3~5명
- 목표: 실제 Claude Code/Codex 환경 scan 정확도 검증
- 배포: source install 또는 prebuilt binary

### Private Beta

- 대상: AI agent를 적극 사용하는 개발팀 2~3곳
- 목표: profile/export/import/drift가 실제 온보딩과 팀 표준화에 도움 되는지 검증
- 배포: Homebrew 또는 package manager

### Public MVP

- 대상: 개인 개발자
- 목표: "내 agent 환경을 한 번에 보여주는 CLI"로 공개 채택
- 배포: GitHub, docs, examples

### Team Preview

- 대상: small engineering team
- 목표: `.aem/team.yaml`과 CI check의 실효성 검증
- 배포: CLI + GitHub Action

## 10. 핵심 마일스톤

| 마일스톤 | 설명 | 성공 기준 |
| --- | --- | --- |
| M0 | Canonical model v0 | fixture 10개 이상 normalize |
| M1 | Scan MVP | Claude Code/Codex 설치 및 config 탐지 |
| M2 | Doctor MVP | 위험/누락 finding 출력 |
| M3 | Desired State MVP | export/import/diff round-trip |
| M4 | Apply MVP | backup 포함 safe apply |
| M5 | Drift MVP | baseline 대비 변경 감지 |
| M6 | Team Baseline | `.aem/team.yaml` CI check |
| M7 | Registry Connector | approved resource sync prototype |

## 11. 제품 리스크와 대응

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| vendor config 변경 | adapter 깨짐 | fixture, version detection, adapter contract test |
| secret leakage | 신뢰 훼손 | redaction default, snapshot test, export guard |
| apply로 설정 손상 | 사용 중단 | backup, dry-run default, rollback doc |
| canonical model 과설계 | 개발 지연 | MVP field 최소화, unknown metadata 허용 |
| 중앙 Registry와 포지션 혼동 | 메시지 약화 | local desired state manager로 명확히 정의 |
| observability 제품과 혼동 | 범위 확장 | execution log 분석은 adapter 연계로 제한 |
| enterprise 요구 과다 | 사이드프로젝트 실패 | Free/Team CLI 완성 전 SaaS 금지 |

## 12. 개발 착수 순서

1. repository scaffold
2. schema와 fixture 작성
3. adapter interface 정의
4. Claude Code adapter read-only 구현
5. Codex adapter read-only 구현
6. `aem scan` 구현
7. `aem doctor` 구현
8. export/import round-trip
9. desired state diff
10. safe apply with backup
11. drift detection
12. 문서와 example profile 정리

이 순서의 의도는 apply 같은 위험한 기능을 나중에 두고, 먼저 read-only 탐지와 모델 안정성을 확보하는 것이다.
