# Agent Environment Manager — 권한 레이어 설계 (v0.7)

문서 상태: Draft (2026-09-04)
기준 문서: `01-project-philosophy-and-policy.md`, `04-implementation-status.md` (D10, D11)

## 1. 왜

README는 "내 에이전트가 지금 뭘 할 수 있나를 한 곳에서 답한다"고 약속하지만 v0.6.0까지의 코드는 permission 표면을 읽지 않는다. 개인에게 설정 동기화는 dotfiles 급 가치지만, **"내 에이전트(와 그 서브에이전트)가 어디까지 허용돼 있나"**는 시작 시점과 확장을 추가하는 시점마다 실제로 묻는 질문이다.

실측(2026-09-03, 개발 머신):

- 플러그인 하나가 13개 이벤트에 27개 훅을 걸고, 그 안에 `PreToolUse`·`PermissionRequest` 훅이 있다 → 플러그인이 권한 프롬프트에 개입한다.
- `skipDangerousModePermissionPrompt`가 켜져 있다.
- 서브에이전트 19개 중 tool 제한이 있는 것은 9개.
- Codex는 `approval_policy`/`sandbox_mode` 미설정(기본값) + `trust_level = "trusted"` 프로젝트 다수.

즉 권한은 `settings.json`이 아니라 **확장(플러그인·훅·에이전트)이 결정**하고 있고, 아무도 그걸 리뷰하지 않는다. 플러그인 인벤토리(D10)는 설정 목록이 아니라 권한 공급망 목록이다.

## 2. 원칙

1. **aem은 policy compiler + auditor다. 런타임 enforcer가 아니다.** 벤더가 이미 로컬 enforcement 지점을 갖고 있다(Claude `permissions`/managed-settings/서브에이전트 `tools`, Codex `approval_policy`/`sandbox_mode`/requirements). aem은 벤더 중립 정책을 읽고·검사하고·(v0.8부터) 벤더 네이티브로 컴파일한다. 01의 "실시간 차단/프록시 안 함"은 유지.
2. **천장(ceiling)은 상속되고 좁혀지기만 한다.** 서브에이전트 effective = 메인 effective ∩ 역할 천장. 벤더 시맨틱과 동일.
3. **손실(fidelity)은 숨기지 않는다.** capability ↔ 벤더 설정 매핑은 `exact | lossy | unknown`으로 표시하고, `check`는 lossy를 보고하되 차단하지 않는다.
4. **개인 로컬 우선.** 서버·네트워크 없음. `policy.yaml`은 git에 커밋되는 파일이며 팀/기업으로 갈 때 스코프만 늘어난다.
5. **v0.7은 벤더 설정을 쓰지 않는다.** `init`이 만드는 것은 aem 자신의 `.aem/policy.yaml`뿐.

## 3. 세 순간과 명령

| 순간 | 질문 | 명령 |
| --- | --- | --- |
| 프로젝트 시작 | 이 프로젝트에서 내 에이전트는 뭘 해도 되나 | `aem init` → `.aem/desired-state.yaml` + `.aem/policy.yaml` 스캐폴드 |
| 확장 추가 | 이 플러그인/훅/에이전트가 뭘 들여오나 | `aem scan`/`doctor` — 확장별 권한 기여 + `permission_risk`/`hook_risk` finding |
| 핸드오프 | 서브에이전트/다른 모델은 어떤 권한으로 도나 | `aem check` — 정책 천장 vs 메인·서브에이전트 effective, 위반 시 exit 5 |

`policy.yaml`은 `desired-state.yaml`과 **별도 파일**이다. desired-state는 "뭐가 있어야 하나"(인벤토리), policy는 "뭘 해도 되나"(경계)라 변경 주기·리뷰어가 다르고, 팀 단계에서 policy만 관리자 소유로 분리하기 쉽다.

## 4. Canonical 모델 추가 (`aem.dev/v0`)

```ts
type ShellAccess      = "none" | "prompt" | "allowlist" | "full";     // 격자 순서
type FilesystemAccess = "read" | "prompt" | "workspace" | "full";
type Fidelity         = "exact" | "lossy" | "unknown";

interface Capabilities {          // 필드 없음 = 벤더가 표현하지 않음
  shell?: ShellAccess;
  filesystem?: FilesystemAccess;
  network?: boolean;
  mcp?: string[];                 // 접근 가능한 MCP 서버 id
  bypassPrompts?: boolean;        // 프롬프트 자동 승인/위험 모드
  model?: string;
}

interface PermissionSurface {     // RuntimeState.permissions
  effective: Capabilities;        // 메인 에이전트 effective
  fidelity: Partial<Record<keyof Capabilities, Fidelity>>;
  mode?: string;                  // 벤더 라벨: defaultMode / approval_policy+sandbox_mode
  rules: PermissionRule[];        // 벤더 네이티브 규칙 원문 (allow/deny/ask + pattern)
  managedPolicyPath?: string;     // 관리자 정책 파일 존재(사용자 override 불가)
  trustedProjects?: string[];     // Codex trust_level, 경로 portable
}

interface HookRegistration {      // RuntimeState.hooks
  event: string;                  // PreToolUse, PermissionRequest, SessionStart …
  matcher?: string;
  command: string;                // ${CLAUDE_PLUGIN_ROOT} 치환
  origin: "user" | "project" | `plugin:${string}`;
  sourcePath: string;
}

interface AgentDefinition {       // RuntimeState.agents
  id: string;
  origin: "user" | "project" | `plugin:${string}`;
  path: string;
  model?: string;
  tools?: string[];               // allowlist; undefined = 메인 상속
  disallowedTools?: string[];
  permissionMode?: string;
}
```

effective 계산은 core(`src/core/permissions/`)가 한다: `narrow(main, agent)`는 `tools`/`disallowedTools`에서 Bash·Write/Edit·WebFetch·MCP 툴 이름을 capability로 내려 격자상 min을 취한다.

## 5. 벤더 매핑 (v0.7 읽기)

| capability | Claude Code | fidelity | Codex | fidelity |
| --- | --- | --- | --- | --- |
| shell | `permissions.allow/deny`의 `Bash`/`Bash(pattern)`; `defaultMode=bypassPermissions` → full | exact | `sandbox_mode` + `approval_policy` 조합(read-only→prompt/none, workspace-write→allowlist, danger-full-access→full; `never`면 프롬프트 없음) | lossy |
| filesystem | `acceptEdits`→workspace, deny `Write/Edit`→read, 기본→prompt | lossy | `sandbox_mode` (read-only/workspace-write/danger-full-access) + `writable_roots` | exact |
| network | deny `WebFetch/WebSearch` + shell none → false, 그 외 true | lossy | `[sandbox_workspace_write].network_access`, full-access→true, read-only→false | exact |
| bypassPrompts | `defaultMode=bypassPermissions` \| `skipDangerousModePermissionPrompt` | exact | `approval_policy = "never"` | exact |
| mcp | 활성 서버 id (플러그인 번들 포함) | exact | `[mcp_servers.*] enabled` | exact |
| model | `settings.model` | exact | `model` | exact |
| hooks | settings 레이어 `hooks` + 플러그인 `hooks/hooks.json` | exact | 없음 | — |
| agents | `~/.claude/agents`, `<project>/.claude/agents`, 플러그인 `agents/*.md` frontmatter | exact | 없음(v0.7) | — |
| managed | `/Library/Application Support/ClaudeCode/managed-settings.json`, `/etc/claude-code/managed-settings.json` | exact | 관리자 requirements(경로 확인 후) | unknown |

읽기 레이어 순서(후순위 우선)는 D10과 동일: user `settings.json` → `settings.local.json` → project `.claude/settings.json` → `.claude/settings.local.json`. managed는 최상위이며 별도 표시.

## 6. Policy 스키마 (`.aem/policy.yaml`)

```yaml
schemaVersion: aem.dev/v0
kind: Policy
metadata: { name: <project>, createdAt: … , scope: project }
ceiling:                      # 메인 에이전트 천장, deny-wins
  shell: allowlist
  filesystem: workspace
  network: false
  bypassPrompts: false
  mcp: [github, context7]     # 생략 = 제한 없음
hooks:
  events:                     # 확장이 거는 훅의 허용 범위
    PermissionRequest: deny   # allow | review | deny
    PreToolUse: review
  allowOrigins: [user, project, "plugin:oh-my-claudecode@omc"]
agents:
  "*": { ceiling: { shell: prompt } }          # 기본 서브에이전트 천장
  reviewer:
    ceiling:  { shell: none, filesystem: read }
    requires: { mcp: [github] }                # 바닥(최소)
extensions:
  plugins: { allow: [oh-my-claudecode@omc] }   # 명시 안 된 플러그인은 위반
```

`aem init`은 현재 effective를 천장으로, 활성 플러그인을 allow로, 발견된 훅 이벤트를 `review`로 채운 스캐폴드를 만든다(위험 항목엔 주석). 정책은 벤더 id를 모른다; `applyTo` 없음.

## 7. `aem check`

입력: policy(해석 순서 `--policy` → `<cwd>/.aem/policy.yaml` → 없으면 에러) + fresh scan.
출력 `CheckReport { items: CheckItem[] }`, `CheckItem { runtime, subject: "main" | "agent:<id>" | "hook:<event>" | "plugin:<id>", severity, rule, message, fidelity }`.

규칙:

- `main.<cap>`: effective가 천장 초과 → error (lossy면 warning + fidelity 표시)
- `agent.<id>.<cap>`: `narrow(main, agent)`가 역할 천장 초과 → error; `requires` 미충족 → warning
- `hook.<event>`: `deny` 이벤트에 훅 존재 → error; `review` → info; origin이 `allowOrigins` 밖 → warning
- `plugin.<id>`: allow 목록 밖의 설치·활성 플러그인 → warning

exit code 5 = policy violation(error 존재). `doctor --policy`도 동일 검사를 `policy_violation` finding으로 포함.

## 8. Doctor finding (정책 없이도)

- `permission_risk`: bypassPrompts 켜짐, full shell + network, managed 정책 없이 `defaultMode=bypassPermissions`, trusted 프로젝트가 홈 디렉터리 등 광범위 경로
- `hook_risk`: `PermissionRequest`/`PreToolUse` 훅 존재(origin 표시), 훅 커맨드가 플러그인 루트 밖 임의 경로 실행
- 기존 `dangerous_command`(shell MCP)는 유지

## 9. 범위 밖 (v0.7)

- 벤더 설정 쓰기(컴파일/apply) — v0.8. 그때 처음으로 권한에 backup/confirm/audit 적용, 관리자 천장은 managed-settings emit.
- Codex 서브에이전트/역할 설정 읽기 — 벤더 포맷 안정화 후.
- Cross-vendor 핸드오프의 런타임 권한 전파 — 하네스/벤더 몫. aem은 양쪽 정적 설정이 같은 정책에서 나왔음만 보장.
- ABAC 속성 — `project trust`, `env` 두 개만 후보로 남김.
