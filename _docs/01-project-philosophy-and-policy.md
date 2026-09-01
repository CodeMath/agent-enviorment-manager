# Agent Environment Manager 프로젝트 철학 및 정책

문서 상태: Draft v0.1  
작성일: 2026-09-01  
대상: 창업/사이드프로젝트 초기 팀, 백엔드 엔지니어, 플랫폼 엔지니어

## 1. 한 줄 정의

Agent Environment Manager는 개발자의 로컬 AI 에이전트 실행 환경을 탐지하고, 표준 모델로 정규화하고, 원하는 상태(desired state)로 재현/검증/적용하는 vendor-neutral 환경 관리 도구다.

중앙 Registry가 "조직 안에 어떤 Agent/Tool/Skill/MCP가 존재하고 승인되었는가"를 관리한다면, Agent Environment Manager는 "각 개발자 로컬 환경에 무엇이 설치/설정되어 있고, 정책상 어떤 상태여야 하며, 실제 설정 파일로 어떻게 안전하게 적용할 것인가"에 집중한다.

## 2. 제품 비전

AI 에이전트가 개발 워크플로의 기본 실행 단위가 되면, 문제는 더 이상 "에이전트를 하나 더 만드는 것"이 아니다. 문제는 다음으로 이동한다.

- 어떤 에이전트 런타임이 설치되어 있는가
- 어떤 MCP 서버와 도구가 연결되어 있는가
- 어떤 instruction, rule, skill, profile이 적용되어 있는가
- 어떤 설정이 위험하거나 오래되었는가
- 팀에서 합의한 표준 환경과 개인 로컬 환경이 얼마나 다른가
- 신규 개발자가 같은 환경을 재현할 수 있는가
- 중앙 Registry나 보안 정책이 있어도 실제 로컬 설정에 반영되고 있는가

Agent Environment Manager의 비전은 AI 에이전트 환경을 `dotfiles + 수동 설정 + 기억`의 영역에서 `선언형 desired state + 검증 가능한 적용 + vendor-native 변환`의 영역으로 옮기는 것이다.

## 3. 해결하려는 문제

### 3.1 로컬 에이전트 환경의 불투명성

현재 개발자의 AI 에이전트 환경은 여러 위치에 흩어져 있다.

- Claude Code: 로컬 설정, 프로젝트 instruction, MCP 설정
- Codex: AGENTS.md, skills, plugins, MCP/app 연결, 샌드박스/권한 설정
- Cursor/Kiro/OpenCode/Gemini CLI 등: 각자 다른 설정 구조
- Shell 환경: API key, token, path, runtime dependency
- 프로젝트별 파일: `AGENTS.md`, `.codex/`, `.mcp.json`, vendor별 config

개발자는 실제로 어떤 도구가 연결되어 있고 어떤 권한이 있는지 한 번에 보기 어렵다.

### 3.2 재현 불가능한 개발 환경

에이전트는 사용자의 로컬 설정, 승인된 도구, MCP 서버, instruction에 크게 의존한다. 같은 저장소에서도 개발자마다 결과가 달라질 수 있다.

문제는 단순 생산성 문제가 아니라 품질/보안/감사 문제다.

- A 개발자는 `prod-db-write` MCP를 갖고 있고 B 개발자는 없다
- 팀 표준 instruction이 일부 로컬에만 반영되어 있다
- 오래된 skill/plugin 버전이 남아 있다
- 신규 입사자가 어떤 설정을 설치해야 하는지 문서만 보고 따라 해야 한다
- 설정 변경 이력이 git이나 감사 로그에 남지 않는다

### 3.3 중앙 Registry와 로컬 적용 사이의 빈 공간

AWS Agent Registry 같은 중앙 Registry는 조직 차원의 Agentic Resource catalog와 governance를 제공한다. 하지만 Registry가 있다고 해서 각 개발자의 로컬 Claude Code/Codex/Cursor 환경이 자동으로 안전하고 일관되게 구성되는 것은 아니다.

필요한 것은 Registry의 승인 리소스를 실제 vendor-native config로 변환하고, 로컬 환경에 적용하기 전에 diff/dry-run/doctor/drift detection을 제공하는 실행 가능한 환경 관리 계층이다.

## 4. 핵심 원칙

### 4.1 Observe보다 Manage

수집/관찰 영역은 중요하지만 MVP의 중심은 로그 분석이 아니다. 이 프로젝트의 핵심은 "무슨 일이 일어났는가"가 아니라 "환경이 어떤 상태여야 하는가, 그리고 지금 그 상태인가"다.

### 4.2 Desired State First

모든 설정은 현재 상태(current state)와 원하는 상태(desired state)의 차이로 다룬다.

- 탐지: 현재 설치/설정 상태를 읽는다
- 정규화: vendor별 설정을 canonical model로 변환한다
- 계획: desired state와 비교해 변경 계획을 만든다
- 검증: 위험/충돌/누락을 doctor와 policy check로 검출한다
- 적용: vendor-native config로 안전하게 변환해 적용한다
- 감지: 시간이 지난 뒤 drift를 다시 찾는다

### 4.3 Vendor-native를 존중한다

Agent Environment Manager는 Claude Code, Codex, Cursor, Kiro 등을 대체하지 않는다. 각 도구의 설정 파일과 실행 모델을 존중하고, 추상 모델을 vendor-native config로 변환하는 어댑터 계층을 둔다.

### 4.4 Local-first by Default

개인 사용자의 환경 정보는 기본적으로 로컬에 남는다. 중앙 서버, 계정, 텔레메트리 없이도 핵심 기능이 동작해야 한다.

### 4.5 Enterprise-ready, Enterprise-only 아님

초기 제품은 개인 개발자가 무료로 쓸 수 있어야 한다. 단, 데이터 모델과 아키텍처는 나중에 팀/기업용 정책, 승인, 감사, SSO, Registry 연계가 붙을 수 있도록 설계한다.

### 4.6 Policy는 강제 전에 설명한다

보안/정책 위반은 막는 것만큼 설명이 중요하다. 개발자가 무엇이 위험한지, 왜 변경이 필요한지, 어떤 파일이 바뀌는지 이해할 수 있어야 한다.

### 4.7 Secret은 값이 아니라 참조로 다룬다

API key와 token은 수집/저장/내보내기 대상이 아니다. secret은 `env:OPENAI_API_KEY`, `keychain:...`, `vault:...` 같은 참조로 표현한다.

## 5. 범위와 비범위

### 5.1 포함 범위

- 로컬 AI 에이전트 런타임 탐지
- vendor별 설정 파일 탐지
- MCP 서버 설정 탐지/정규화
- instruction/rule/skill/profile 탐지
- canonical environment model 생성
- local desired state 파일 관리
- dry-run diff
- apply with backup
- doctor check
- export/import
- profile 전환
- drift detection
- 향후 중앙 Registry/Team policy 연계를 위한 adapter interface

### 5.2 제외 범위

- 에이전트 실행 로그의 풀 트레이싱/리플레이
- 세션 replay, token waste 분석, subagent graph 분석
- 중앙 Agent Registry 직접 대체
- MCP server marketplace 운영
- 조직 전체 endpoint agent 배포
- 실시간 런타임 차단/프록시
- secret vault 자체 구현
- IDE/agent runtime 자체 구현
- 모델 라우터 또는 agent orchestrator 구현

## 6. Free -> Team -> Enterprise 철학

| 단계 | 핵심 사용자 | 제품 철학 | 핵심 가치 | 수익화 관점 |
| --- | --- | --- | --- | --- |
| Free | 개인 개발자 | 내 로컬 agent 환경을 이해하고 재현한다 | 탐지, doctor, profile, export/import, dry-run/apply | 무료 OSS 또는 무료 CLI |
| Team | 2~50명 개발팀 | 팀 표준 agent 환경을 git으로 공유하고 drift를 줄인다 | shared baseline, PR check, team profile, policy lint | 유료 SaaS 또는 팀 플랜 |
| Enterprise | 플랫폼/보안 조직 | 중앙 Registry/ID/감사/정책과 로컬 환경을 연결한다 | SSO/RBAC, approval, audit, fleet drift, registry connector | 엔터프라이즈 계약 |

중요한 원칙은 Free 제품이 Team/Enterprise의 데모가 아니라 실제로 유용한 독립 도구여야 한다는 점이다. 개인 개발자가 매일 쓰는 CLI가 되어야 팀 도입의 신뢰가 생긴다.

## 7. Local-first 원칙

MVP와 Free 단계의 기본 정책은 다음과 같다.

- 계정 없이 실행 가능해야 한다
- 모든 탐지 결과는 기본적으로 로컬 저장소에 저장한다
- 민감한 값은 저장하지 않고 redaction한다
- export 파일은 사람이 읽을 수 있는 YAML/JSON이어야 한다
- apply 전에는 항상 diff를 보여줄 수 있어야 한다
- 기존 설정 파일은 백업 후 변경한다
- 네트워크 없이도 scan, doctor, diff, apply가 동작해야 한다

로컬 저장 기본 위치:

- 사용자 범위: `~/.aem/`
- 프로젝트 범위: `<repo>/.aem/`
- export/import 파일: 사용자가 지정한 경로

## 8. Enterprise Governance 원칙

Enterprise 단계에서 제품은 중앙 통제 도구가 아니라 로컬 실행 환경과 중앙 정책의 연결 계층이 된다.

Enterprise governance 원칙:

- 중앙 Registry는 source of approved resources가 될 수 있다
- Agent Environment Manager는 approved resources를 local desired state로 materialize한다
- 정책은 로컬 apply 전에 검증되어야 한다
- 관리자는 누가 어떤 profile을 적용해야 하는지 지정할 수 있다
- 개발자는 변경 diff와 정책 사유를 볼 수 있어야 한다
- audit에는 "무엇을 적용했는가"와 "왜 차단됐는가"가 남아야 한다
- 조직 정책은 vendor-specific 설정 파일보다 상위 계층에 있어야 한다

## 9. Vendor-neutral / Adapter 전략

Agent Environment Manager의 핵심 방어선은 adapter 구조다.

### 9.1 Canonical Model

모든 vendor 설정은 내부적으로 다음 범주로 정규화한다.

- `AgentRuntime`: Claude Code, Codex, Cursor, Kiro 등 실행 환경
- `ConfigSource`: 설정 파일 또는 디렉터리
- `McpServer`: MCP 서버 정의
- `ToolPermission`: 도구 권한, command/network/filesystem scope
- `InstructionPack`: AGENTS.md, rules, memory, system instruction 계열
- `SkillPack`: skill/plugin/extension 계열
- `Profile`: 목적별 설정 묶음
- `EnvironmentSnapshot`: 특정 시점의 current state
- `DesiredState`: 적용하고 싶은 선언형 상태
- `Finding`: doctor/policy/drift 결과
- `ChangePlan`: dry-run/apply 변경 계획

### 9.2 Adapter 책임

각 vendor adapter는 다음 책임을 가진다.

- `discover`: 설치 여부와 설정 위치 탐지
- `read`: vendor-native config를 읽어 canonical model로 변환
- `plan`: desired state를 vendor-native 변경 계획으로 변환
- `apply`: 파일 변경을 백업과 함께 적용
- `doctor`: vendor별 위험/오류/누락 검증
- `render`: canonical desired state를 vendor-native config로 출력

### 9.3 Adapter가 하지 않는 일

- vendor runtime을 재구현하지 않는다
- 비공식 내부 API에 의존하지 않는다
- secret 값을 추출하지 않는다
- vendor가 명시하지 않은 권한 우회를 하지 않는다

## 10. Privacy / Security 원칙

### 10.1 수집 최소화

MVP는 환경 설정 메타데이터만 다룬다. 에이전트 대화 내용, 프롬프트 전문, 파일 본문, 실행 로그 전문은 기본 수집 대상이 아니다.

### 10.2 Secret Redaction

다음 값은 저장/출력/export 대상에서 제거한다.

- API key
- OAuth token
- session token
- cookie
- private key
- database password
- bearer token

대신 secret reference만 보존한다.

예:

```yaml
env:
  OPENAI_API_KEY:
    source: env
    present: true
    value: redacted
```

### 10.3 Apply Safety

설정 변경은 다음 조건을 만족해야 한다.

- dry-run으로 사전 확인 가능
- 변경 파일 목록 제공
- 백업 파일 생성
- partial failure 시 rollback 가능 범위 명시
- 사람이 읽을 수 있는 diff 제공
- unknown field는 기본적으로 보존

### 10.4 Auditability

개인용에서도 최소 감사 기록은 로컬에 남긴다.

- 실행 시각
- 명령
- 대상 profile
- 변경 파일
- adapter 버전
- 결과
- 오류/경고

## 11. 오픈소스 / 상용 경계

### 11.1 오픈소스 또는 무료 코어에 적합한 영역

- 로컬 CLI
- canonical model
- Claude Code/Codex adapter 기본 구현
- scan/doctor/diff/apply/profile/export/import
- local policy lint
- schema 문서
- adapter SDK
- sample profiles

오픈소스 코어의 목표는 개인 개발자 채택과 adapter 생태계 형성이다.

### 11.2 상용 제품에 적합한 영역

- 팀 baseline 관리 UI
- 중앙 policy server
- SSO/RBAC
- 조직 단위 drift dashboard
- 승인 workflow
- AWS Agent Registry, 내부 Registry, ServiceNow, Jira 연계
- 감사 로그 retention
- fleet reporting
- compliance evidence export
- managed distribution
- priority support

상용 경계는 "로컬에서 혼자 해결 가능한가"와 "조직 차원의 관리/증적/권한이 필요한가"로 나눈다.

## 12. 성공 기준

### 12.1 개인 개발자 기준

- 5분 안에 설치하고 첫 scan 결과를 볼 수 있다
- Claude Code/Codex 중 최소 하나의 config를 정확히 탐지한다
- 현재 MCP 서버 목록과 위험 경고를 이해할 수 있다
- profile export/import로 다른 머신에서 환경을 재현할 수 있다
- apply 전에 바뀔 파일을 명확히 볼 수 있다

### 12.2 팀 기준

- 팀 표준 profile을 저장소에 넣고 PR에서 검증할 수 있다
- 신규 개발자 온보딩 시간이 줄어든다
- 팀원 간 MCP/instruction drift를 찾을 수 있다
- 위험한 tool/MCP 설정을 사전에 차단할 수 있다

### 12.3 Enterprise 기준

- 중앙 Registry의 승인 리소스를 로컬 환경으로 안전하게 배포할 수 있다
- 조직 전체 agent environment inventory를 볼 수 있다
- 정책 위반과 예외 승인을 감사할 수 있다
- 보안팀과 플랫폼팀이 vendor별 설정 파일을 직접 추적하지 않아도 된다

## 13. 제품 포지셔닝

Agent Environment Manager는 다음과 같이 포지셔닝한다.

- Agent Registry가 아니다
- Agent runtime이 아니다
- Agent observability dashboard가 아니다
- Secret manager가 아니다
- IDE plugin 하나가 아니다

대신 다음이다.

- AI agent 개발 환경의 desired state manager
- vendor-neutral local config normalizer
- MCP/instruction/skill/profile drift detector
- 중앙 governance와 로컬 실행 환경 사이의 adapter layer

초기 메시지는 단순해야 한다.

> "내 Claude Code/Codex 환경에 무엇이 설치되어 있고, 팀 표준과 무엇이 다른지 보여주고, 안전하게 맞춰준다."
