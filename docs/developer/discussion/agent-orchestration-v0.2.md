# DSH Agent Orchestration Development Plan (One-Person Studio)

English | [中文](agent-orchestration-v0.2.zh.md)

Version: 0.2 (development plan rewritten from requirements document 0.1); date: 2026-09-04; scope: single-user use on a self-maintained DeepSeek Harness (DSH) branch, implemented as Web plugins.

Document status: this is the original proposal snapshot migrated into the repository to preserve the requirements source. Later investigation has revised implementation assumptions including “external CLIs first,” an independent `board.json`, a resident manager process, and Gemini CLI. Current implementation guidance is in [External agent CLI integration research](agent-orchestration-cli-integration-research.md) and [DSH-native Crew orchestration development plan](agent-orchestration-core-development-plan.md).

---

## 0. Changes from 0.1

Added: manager dispatch through crew MCP tools, the manager runtime form (resident process plus event wake-up), worker isolation (module directory plus README work order), status-light signal sources, hard completion checks, stop protocol, engine capability matrix, prompt rules, development order, and risk register.

Changed: “session too long” is now a fourth condition for opening a new session; Git commits go through a crew gate; login explicitly launches each CLI's own interactive login.

Unchanged: the goal, four roles, user interaction only with the manager, right-side worker list, the on-disk `docs/` and `tests/` contract, and two settings sections.

---

## 1. Goal and scope

Problem to solve: subscriptions are split across vendors, each model has different strengths, a person will not always choose correctly, and context has to be copied repeatedly.

Product form: a crew inside one project room. The user speaks only with the manager, and the manager assigns work by role to subscribed official development tools such as Claude Code and Codex. This is not “many model buttons in one window.”

The first version implements only a software development crew. Art and modeling can later expand through the same “trade + working directory + session binding” model.

Explicitly out of scope for the first version: multiple users, holding another person's API key, automatic manager selection, direct user conversation with subagents, permission prompts for every command, and reusing DeepSeek usage queries for other vendors.

Compliance position: all model calls occur inside each vendor's official CLI process. DSH only starts processes, passes arguments, and receives results. It does not extract any provider's login credentials to call APIs directly.

---

## 2. Settled decisions

The following are assumptions for this proposal, and later sections build on them.

| Subject | Decision | Reason in one sentence |
|---|---|---|
| How the manager dispatches | The crew plugin embeds an MCP server, and the manager engine calls `dispatch / append / stop / status / integrate / commit` as MCP tools | The manager is a model running inside a CLI and cannot spawn processes itself |
| Manager runtime | A resident process in one session; each turn ends with a closing line and becomes idle; crew injects an event message to wake it | Worker duration is uncertain, so the manager cannot occupy a model while waiting |
| Worker runtime | One dispatch or append equals one bounded headless run (similar to `-p`), resumed by session ID | Worker tasks are naturally bounded and do not need to remain resident |
| Worker isolation | Dispatch prepares a module directory, worker cwd is that directory, and its `README.md` is the work order; prompts, each CLI's own guardrails, and a second approval layer provide isolation | For single-user use, models usually remain in scope; worktrees are not introduced |
| Status-light source | Structured engine output or exit code plus stop-protocol markers plus crew hard completion checks | A worker's self-reported “complete” is not authoritative |
| Git commit | Only the manager, and only through the `crew.commit` gate; the manager engine itself receives no Git-write permission | Enforce the rule rather than rely on a prompt |
| Login | Launch each CLI's own interactive login through a PTY; DSH only probes login state | Do not implement headless login |
| Session too long | Allow it as the fourth reason to create a session, after writing a handoff summary | Long sessions resend full history each turn, so quota consumption grows with length |

---

## 3. System architecture

```text
┌──────────────────────── DSH 桌面壳 / Web ────────────────────────┐
│  中间：厂长对话        右侧：工人列表        设置：岗位表 + 登录额度  │
└──────────────┬──────────────────┬─────────────────────┬───────────┘
               │                  │                     │
        ┌──────▼──────┐    ┌──────▼──────┐       ┌──────▼──────┐
        │    crew     │    │    roles    │       │  providers  │
        │ 编排 + MCP  │◄───│  岗位表     │◄──────│ 五家适配器  │
        └──────┬──────┘    └─────────────┘       └──────┬──────┘
               │  MCP 工具                               │ 启动 / 登录 / 额度
        ┌──────▼──────┐                          ┌──────▼──────┐
        │ 厂长进程     │  crew 注入事件消息        │ 工人进程 ×N  │
        │ (常驻)      │◄─────────────────────────│ (有界运行)   │
        └─────────────┘                          └─────────────┘
```

Three plugins, not folded into the existing DeepSeek usage-query plugin:

| Plugin | Responsibility |
|---|---|
| providers | Five vendor adapters: probe CLI, capability matrix, build launch arguments, launch login, query login and quota, and normalize output streams. DeepSeek continues through the existing usage plugin and occupies one “DeepSeek (API)” row in settings. |
| roles | Read and write the role table (role → engine + model + reasoning level); changes affect only the next assignment; active jobs lock their startup binding; saving validates engine capabilities and login state. |
| crew | Dispatch board, session binding, manager runtime (resident + wake-up), worker runtime, stop-protocol parsing, hard completion checks, review and integration flow, commit gate, right-side list data, and MCP server. |

Orchestration state follows the crew board, including its session ID mapping, plus repository `docs/`; it does not live only in plugin memory because DSH can still make breaking changes.

Studio code and business repositories remain separate. Workers may not modify the studio's own plugin code unless this repository is the repository currently open.

---

## 4. Runtime model

### 4.1 Manager: resident plus wake-up

- Each project has one manager process and one session. Crew starts the process and keeps stdin open, exchanging streaming JSON messages. Claude Code can use a long-session Agent SDK mode or `-p` streaming input; exact arguments follow the current CLI reference. Other engines use an equivalent capability or PTY.
- If an engine has no resident headless mode, the adapter degrades to “one `-p --resume` per wake-up.” The public interface remains `ManagerRuntime.send(message)`.
- Each manager turn ends with a closing phrase. After the result event, the process remains alive without consuming the model. The manager never polls, sleeps, or waits.
- Wake-up means crew injects a message into the manager session. User messages and crew event messages enter the same FIFO queue; nothing is injected during a manager turn, and the next item is taken after the turn ends.
- On DSH restart or process death, resume by session ID; if resume fails, use the session recovery in Section 5.

Closing-line rule for the manager prompt: the final line of every turn is `等待：<模块列表 | 用户 | 无>`, which lets the right side show what the manager is awaiting.

### 4.2 Worker: one dispatch equals one bounded run

- Each `dispatch` or `append` starts one headless process with cwd set to the module directory, passing the work order and permissions and resuming by session ID.
- Process exit ends the turn. Exit code, completion report, and hard checks together determine status as described in Section 8.
- `stop`: send SIGINT first to end the current turn (confirmed for Claude Code: SIGINT ends the turn, whereas SIGTERM leaves an unfinished turn that continues on resume), then send SIGTERM after a timeout.

### 4.3 Worker state machine

```text
queued ──启动──► running(绿)
running ──收工报告 done + 硬检查通过──► done(无色) ──厂长 append──► running
running ──收工报告 blocked / 权限被拒 / 硬检查未通过超次──► paused(黄) ──处理后 append──► running
running ──退出码非零 / 进程死亡 / 会话恢复失败 / 连续失败──► failed(红) ──换人或修复──► running
```

- Yellow and red both carry `reason` (enum plus original text), shown in right-side details.
- `done` does not destroy the session; it means idle. An append returns it to running on the same row.

### 4.4 Events and wake-up supplement

Every wake-up is a manager-engine turn and consumes manager quota. Therefore:

- Wake-up events are limited to development completion after hard checks and automatic review dispatch, review pass, review rejection over the limit, integration conclusion, yellow status, and red status.
- Progress events such as a running worker or ongoing review do not wake the manager; they only update the right side.
- Multiple events within the same window, five seconds by default, are merged into one message.

Event message format:

```text
[crew事件 2026-09-04 14:03]
- 模块 auth：开发完成，收工检查通过，已自动转审查
- 模块 payment：黄灯（需要依赖）：stripe@^14 —— 工人原文：……
- 模块 report：审查通过（第 2 轮）
```

---

## 5. Session binding

The background binding key is `project + role + module → session_id`, maintained by crew; the user never copies it.

| Role | Session granularity | Description |
|---|---|---|
| Manager | One per project | Resident and resumed after restart |
| Development | One per module | Rejected fixes and user additions use the same session ID |
| Review | One per work order | Resume when supported |
| Integration | One per work order | Same as above |

Only four conditions allow a new session:

1. A new module.
2. The user changes the engine for that role; changing engine means changing worker.
3. The old session is confirmed unrecoverable.
4. The session is too long: it exceeds the threshold configured in roles, either a turn count or observed engine context compaction. Before opening another session, crew appends one request to the old session to “write a handoff summary to `docs/log/<模块>-dev.md`.” After success, the first new-session message points to that summary. The manager session behaves similarly, writing handoff into the “Current state” section of `docs/project.md`.

Disk is the fallback. If a session dies, recover from `docs/` and `tests/` before continuing instead of starting empty.

Confirmed for Claude Code: the session ID appears in the `--output-format json` result, and `--resume <id>` can restore from any directory since v2.1.223; earlier versions required the same project directory. Resume mechanisms for other engines still need per-provider confirmation in Section 12.

---

## 6. Directories, work orders, and disk contract

### 6.1 Repository layout

```text
<业务仓库>/
  src/<模块>/                 # 模块目录 = 工人 cwd（目录名由模块规格指定，默认 src/<模块>/）
    README.md                 # 工单，crew 从模块规格 + 角色模板渲染，工人只读
    ...                       # 模块代码
  src/shared/                 # 厂长铺场时写好的公共接口 / 类型 / 桩，工人只读
  docs/
    project.md                # 厂长维护的总规格：目标、模块划分、接口契约、依赖顺序、当前状态
    modules/<模块>.md          # 模块规格：目标、非目标、接口、验收、模块目录、测试路径与命令
    log/<模块>-dev.md          # 开发记录，完成后不得删；含交接摘要
    log/<模块>-review.md       # 审查记录
    log/integrate.md          # 整合记录
  tests/
    <模块>.*                   # 测试脚本，完成后不得删，与模块规格对应
```

Crew runtime data such as board, raw output stream, and worker logs lives under the DSH data directory at `<dsh_data>/crew/<仓库标识>/`. It does not enter the business repository and does not require a `.gitignore` change.

### 6.2 Who writes the work-order README

The manager writes `docs/modules/<模块>.md` as the specification. When calling `crew.dispatch`, crew creates the directory and renders the specification plus role template into `README.md`. The specification then has one source, and the work order is derived. If direct manager-authored README files are preferred, the rendering step can be disabled without changing the interface.

### 6.3 Contract

- Development completion requires a module specification, development log, and matching tests, and the test command must execute and pass.
- Review checks against the specification, verifies `git diff` paths are authorized, and confirms tests cover acceptance and run successfully.
- Integration accepts only review-passed modules, runs the complete `tests/`, writes an integration log, and then returns to the manager.
- Future trades such as art add directories under the same rules, such as `assets/`, without changing the main flow.

---

## 7. Guardrails and permissions

### 7.1 Preparation and division of work

| Subject | Owner |
|---|---|
| Scaffolding, lockfile, dependency installation, executable test command, and interfaces/types/stubs in `src/shared/` | Manager, completed before dispatch |
| A worker needs a new dependency | Worker pauses yellow; manager decides and installs, then appends a restart message; worker does not change the environment |
| Code inside the module and that module's tests | Worker, fully automatic within the guardrail |
| Writing outside the guardrail, changing global config, or uncontrolled network use | Pause yellow; manager notifies the user |
| `git add` / `commit` | Manager only, through `crew.commit` |
| Read docs, sample code, and confirm delivery with the user | Manager before delivery |

Before installing dependencies, the manager calls `crew.status()`. If any worker is running, it waits for done or yellow, or stops the worker first, preventing lockfile and `node_modules` changes while tests run; see risk R1.

### 7.2 Worker writable scope

Dispatch narrows writes to:

- The module directory (`src/<模块>/`, or paths explicitly allowed by the specification)
- `docs/modules/<模块>.md` and `docs/log/<模块>-*.md`
- `tests/<模块>.*`

All other repository content is read-only. Prohibited operations include Git writes (`add / commit / checkout / reset / stash / push`), package-manager installation, global configuration changes, and leaving the repository. Allowed operations include `git status / diff / log` and test commands named by the specification.

Implementation detail: worker cwd is the module directory, while `docs/` and `tests/` are at repository root and therefore outside cwd. Claude Code needs `--add-dir <仓库根>` to mount the repository, settings `permissions.deny` to restrict `Edit / Write` paths, and an `--allowedTools` allowlist for Bash commands. Permission syntax such as `Bash(git diff *)` uses a trailing space plus asterisk for prefix matching. Writable-root mechanisms for other engines still need confirmation.

### 7.3 Second-layer approval and yellow status

- No prompt appears inside the guardrail.
- When a worker touches the guardrail, the engine rejects or requests permission. Two paths are confirmed for Claude Code:
  - Without a permission host, it rejects directly; stream JSON contains a `permission_denied` system message and the final result lists `permission_denials`. `--permission-prompts none` can prevent model retries.
  - With a permission host, `--permission-prompt-tool <MCP 工具>` or the Agent SDK `canUseTool` callback hands the request to crew. Crew turns yellow immediately, and the user can approve, deny, or set “automatic for this class” in right-side worker details.
- If another engine's headless mode exits on denial, “approve” means resume through `append` with a relaxed guardrail. UI wording is consistently “Approve and continue.”

---

## 8. Stop protocol and completion checks

### 8.1 Completion report required at the end of a worker turn

```json
{
  "status": "done | blocked | failed",
  "reason": "dependency | permission | test_red | unclear_spec | other",
  "summary": "一段话",
  "needs": ["stripe@^14"],
  "files_changed": ["src/payment/..."],
  "tests": { "command": "...", "passed": true }
}
```

- Claude Code uses `--output-format json --json-schema` to return structured output directly, confirmed under `structured_output`.
- For other engines, the adapter parses the fenced JSON block in the final message; parse failure is treated as failed.
- Workers never ask the user. `unclear_spec` is blocked and returns to the manager.

### 8.2 Status decision by crew, never worker self-report

1. Nonzero exit code → red, with stderr and final error classification.
2. A `blocked` report → yellow, preserving its reason.
3. A `done` report → hard checks:
   - `docs/modules/<模块>.md` and `docs/log/<模块>-dev.md` exist and changed in this run;
   - The test path named by the specification exists;
   - Crew runs the specification's test command itself, and it passes;
   - Every changed path in `git status --porcelain` is inside the allowlist.

   If every check passes → done and automatically dispatch review. If any fail → automatically append one “completion check failed: … please complete it” turn. A second failure → yellow with `reason = handoff_check_failed`.
4. Each work order has limits configured by roles: maximum turns (Claude Code uses `--max-turns`), maximum wall time, and maximum concurrent workers per project. Reaching a limit → yellow with `reason = budget`.

### 8.3 Stop reasons for display, not a closed list

Waiting for out-of-guardrail permission, needing a dependency, quota exhausted, login expired, network failure, excessive review rejection, red tests, process death, failed completion check, and over budget.

Confirmed for Claude Code: API retry events `system/api_retry` carry error classifications including `authentication_failed`, `rate_limit`, `billing_error`, `overloaded`, and `server_error`. A null `error_status` means a connection error without an HTTP response. The adapter can distinguish login expiration, quota exhaustion, and network failure more accurately than by exit code. Each other engine needs corresponding signals.

---

## 9. Review and integration flow

```text
开发 done + 硬检查通过
  └─► crew 自动派审查（绑定本工单会话）
        ├─ pass  ──► 事件唤醒厂长
        └─ reject ─► crew 直接 append 到开发会话（附问题清单），不经厂长
                     打回次数 ≥ N（默认 3）──► 黄，唤醒厂长
全部模块 pass
  └─► 厂长调用 crew.integrate()
        └─► 整合工人：跑全量 tests/，写 docs/log/integrate.md，输出结论
              ├─ pass  ──► 唤醒厂长 → 厂长抽查 → 向用户交付 → crew.commit
              └─ fail  ──► 唤醒厂长，附失败模块与日志；厂长决定 append 哪个模块
```

Review result format:

```json
{ "verdict": "pass | reject", "issues": [{ "file": "...", "line": 0, "problem": "...", "expected": "..." }] }
```

---

## 10. crew MCP tool interface

Tools are exposed only to the manager engine. Every return value is short and status-level; worker logs are not injected back into the manager because they live on disk and in the right-side panel, preventing manager-session growth.

| Tool | Arguments | Return | Description |
|---|---|---|---|
| `crew.dispatch` | `module`, `role`(dev) | `{job_id, session_id, status}` | Read `docs/modules/<module>.md`, create the directory, render README, and start a worker from the role table. Missing specification fields reject without starting. |
| `crew.append` | `module`, `message` | `{job_id, status}` | Append to the session bound to that module; done → running. |
| `crew.stop` | `module` | `{status}` | SIGINT followed by SIGTERM after timeout. |
| `crew.status` | `module?` | Board summary | One row per module with role, engine, status, reason, and latest sentence. |
| `crew.reassign` | `module`, `engine`, `model?` | `{job_id, session_id}` | Change worker: new session whose first message points to `docs/log/<module>-dev.md` for recovery. |
| `crew.integrate` | — | `{job_id}` | Callable only after every module passes review; otherwise reject and list modules not passed. |
| `crew.commit` | `message` | `{commit_hash}` or rejection reason | Gate: reject while any worker is running; exclude DSH runtime data from the commit. |

Manager engine permissions: write repository root for preparation, allow package manager and test Bash commands, and prohibit Git writes because commits only use `crew.commit`.

---

## 11. Prompt rules

Injection differs by engine. Claude Code uses `--append-system-prompt-file`, as confirmed. Do not use `--bare`: bare mode does not use subscription login and only reads API keys; without bare, `-p` loads the business repository's `CLAUDE.md`, `.claude/settings.json`, and `.mcp.json`, so role instructions must not modify those repository files. Other engines use their supported mechanism, such as AGENTS.md, GEMINI.md, or a system-prompt argument, after confirmation.

### 11.1 Manager prompt skeleton

The manager is critical. Every item below must appear in the prompt, although wording may change.

**Identity and scope**
- You are the project manager. Only you speak with the user; the user can see workers but will not speak with them.
- You do not write module code. Dispatch all module development. Your duties are requirements clarification, overall specification, preparation, dispatch, event handling, acceptance, delivery, and commit.
- Do not decide to switch models or engines for the user. If quota is exhausted or a worker is red, explain why and offer two choices: handle it yourself or continue with another subscribed tool. Wait for the user's choice.

**Flow**
1. Clarify the goal, non-goals, and acceptance with the user.
2. Write `docs/project.md` with module boundaries, interface contracts, dependency order, and test strategy.
3. Prepare scaffolding, dependencies, lockfiles, executable tests, and interfaces/types/stubs in `src/shared/` before dispatch.
4. Write `docs/modules/<模块>.md` for every module, then call `crew.dispatch`.
5. Process `[crew事件]` each turn, act according to the event table, and end with the closing line.
6. When every review passes, call `crew.integrate`.
7. After integration passes, read `docs/`, the integration log, and test results, sample the diff rather than the whole repository, deliver to the user, and call `crew.commit` after user approval.

**Module decomposition principles**
- Interface first: define cross-module interfaces in `docs/project.md` and `src/shared/` before decomposition. Workers depend on interfaces, not another module's implementation.
- Every module is independently testable. Prepare stubs or fakes for dependencies, or dispatch in dependency order after a foundational module passes review. Modules that “must wait for another implementation before testing” cannot run concurrently.
- One module is the amount one development session can complete. Split it again if it cannot.
- Two modules never modify the same file. Shared code belongs to `src/shared/` and is written by the manager during preparation.
- Every module specification includes goal, non-goals, interface inputs/outputs/errors, acceptance items, module directory, test path, and a test command runnable independently in that module.

**Event handling table**

| Event | Action |
|---|---|
| Development completed and review dispatched | No action; record it in the closing line |
| Review passed | If all passed, call `crew.integrate`; otherwise record it |
| Review rejection over limit | Read `docs/log/<模块>-review.md`; decide whether the problem is specification or implementation; update the specification then append for a specification issue, or append explicit instructions for implementation |
| Yellow: dependency required | Call `crew.status`; install when no worker is running; call `crew.append` to say installation is complete |
| Yellow: out-of-guardrail permission | Tell the user and wait for right-side approval or instruction |
| Yellow: unclear specification | Ask the user, revise the specification, and append |
| Yellow: over budget | Decide whether to grant one more round or split the module |
| Red: quota, login, or network | Tell the user why and present two choices, then wait |
| Red: process death or missing session | `crew.reassign` with the same engine and recover from disk; tell the user after another failure |
| Integration failed | Identify the failing module and append a repair; do not modify the code yourself |

**User requirement changes**
- Additions, changes, and rework all use `crew.append` on the original module session; do not open a new one. Role-table changes affect only the next work order.

**Turn rules**
- Do not poll, sleep, or say “waiting…”. End the turn immediately after dispatch.
- The final line is always `等待：<模块列表 | 用户 | 无>`.
- Use the user's language.

**Prohibited**
- Do not directly edit module code, commit while a worker is running because the tool will reject it, or repeat large worker logs to the user; summarize and direct the user to the right side.

### 11.2 Development worker work order README template

```markdown
# 工单：<模块>

## 目标 / 非目标
<来自 docs/modules/<模块>.md>

## 接口
<来自规格；共享类型见 ../shared/>

## 验收
<条目>

## 你的工作范围
- 可写：本目录；../../docs/modules/<模块>.md；../../docs/log/<模块>-*.md；../../tests/<模块>.*
- 只读：仓库其余部分
- 测试命令：<在本目录可独立运行>

## 必须做
- 开发记录写入 ../../docs/log/<模块>-dev.md（过程、决定、未尽事项），完成后不得删
- 测试写入 ../../tests/<模块>.*，与验收条目一一对应，完成后不得删
- 收工前跑测试命令，必须通过

## 禁止
- 安装依赖、改环境、改全局配置、改本目录之外的代码
- 任何 git 写操作
- 向用户提问：遇到自己解决不了的，停下来，按下面格式报告

## 收工报告（回合末尾必须输出）
<第 8.1 节的 JSON schema>
```

### 11.3 Review worker

Input: module specification, `git diff`, development log, and test path. Work: check every acceptance item against the specification, verify changed paths are authorized, and run tests. Output the Section 9 result JSON and write `docs/log/<模块>-review.md`. Do not modify code.

### 11.4 Integration worker

Input: the list of review-passed modules and `docs/project.md`. Work: run all `tests/`, verify cross-module interfaces, and write `docs/log/integrate.md`. Output `{verdict, failing_modules, notes}`. Do not modify code; identify the owning module for every problem.

---

## 12. providers: engine adapters and capability matrix

### 12.1 Adapter interface

Each vendor implements one adapter:

```text
probe()            → 装没装、版本
capabilities()     → 见 12.2
login()            → 拉起该 CLI 自己的交互登录（PTY：内嵌终端或外部终端）；不做无头登录
auth_status()      → 已登录 / 未登录 / 失效
quota()            → 剩余 或 「未知」、重置时间、最近错误；没有可靠数字就写未知
build_args(role, module, fence, prompt_file) → 启动参数
run(args, cwd, stdin) → 归一化的事件流：init / text / tool / permission_request / permission_denied / api_error(分类) / result(含 session_id, 报告)
resume_args(session_id) → 恢复参数
```

Confirmed login detail: terminal-only built-in commands such as Claude Code `/login` are unavailable in `-p` mode, so `login()` must use a PTY and providers cannot be designed only around stdin/stdout pipes.

### 12.2 Capability matrix

Minimum capabilities by role:

| Capability | Manager | Development | Review | Integration |
|---|---|---|---|---|
| Headless non-interactive run | Required, or resident headless | Required | Required | Required |
| Resume by session ID | Required | Required | Preferred | Preferred |
| Structured output | Preferred | Required | Required | Required |
| Path permissions / writable root | Preferred | Required | Preferred, read-only | Preferred |
| MCP client | Required | No | No | No |
| Shell and test execution | Required | Required | Required | Required |
| Permission host for online approval | No | Preferred | No | No |

Current provider status:

| Engine | Status | Notes |
|---|---|---|
| Claude Code | Confirmed to satisfy all | `-p`, `--resume`, `--output-format json/stream-json`, `--json-schema`, `--allowedTools`, `--permission-mode`, `--permission-prompt-tool`, `--add-dir`, `--max-turns`, `--append-system-prompt-file`, and `--mcp-config`. See R2. |
| Codex | To probe | Confirm headless mode, resume, sandbox writable roots, structured output, and MCP client individually before completing the row |
| Grok | To confirm | Determine whether an official agent CLI exists and supports headless and resume. If it is only a conversational model, it cannot be a worker yet |
| Antigravity / Gemini | To confirm | Antigravity is believed to be an IDE rather than a programmable CLI; Gemini CLI may be the drivable surface. Confirm before choosing |
| DeepSeek (API) | Existing | Uses the current usage plugin; acting as a worker would require its own agent loop, so the first version shows only a settings row |

The roles page disables engines that lack a role's capabilities and validates at save time rather than waiting for dispatch failure.

---

## 13. roles and settings

**Role table**: manager / development / review / integration → engine + model + reasoning level + per-job limits (turns, wall time) + long-session threshold + review-rejection limit + concurrency.

- Changes affect only the next assignment; active jobs retain their startup binding.
- Saving warns when a role's engine is unauthenticated or quota is exhausted.
- Recommendation, not enforcement: development and review should not use the same engine and model.

**Worker login**: one row per vendor with login button to launch PTY login, login state, remaining quota or “unknown,” reset time, and latest error.

When quota is exhausted, that worker stops red and the manager notifies the user; the system never silently changes models.

---

## 14. Interface

**Center: manager conversation.** Project-wide discussion, design, dispatch, acceptance, and delivery all occur here. The manager's closing line can be highlighted.

**Right: worker list.** One vertical list split in the middle, active workers above and completed workers below.

Each row shows a colored dot, role, module name, one-line status from the reason, and a shortened session ID for acceptance. Selecting it shows normalized stream logs from the DSH data directory, completion report, review result, guardrail request with approve/deny/always-for-this-class, and original errors. There is no input box.

| Color | Meaning |
|---|---|
| Green | running |
| Yellow | paused, with a request or action needed from user or manager |
| Red | failed |
| None | done, with a retained session that can be appended |

**Settings page**: role table plus five vendors' login and quota.

**Minimal project bar**: current repository path, test-green state, uncommitted-change state, and manager state (in turn or waiting for …).

---

## 15. Data model (board)

`<dsh_data>/crew/<仓库标识>/board.json`, written only by crew.

```json
{
  "repo": "/path/to/repo",
  "manager": { "engine": "claude-code", "model": "...", "session_id": "...", "turns": 42, "state": "idle | busy" },
  "jobs": {
    "auth": {
      "role": "dev", "engine": "codex", "model": "...", "effort": "high",
      "session_id": "...", "module_dir": "src/auth", "state": "done",
      "reason": null, "turns": 17, "review_rounds": 1,
      "fence": { "write": ["src/auth/", "docs/modules/auth.md", "docs/log/auth-*.md", "tests/auth.*"] },
      "history": [{ "t": "...", "event": "dispatched" }, { "t": "...", "event": "done" }]
    }
  },
  "reviews": { "auth": { "session_id": "...", "verdict": "pass" } },
  "integrate": { "session_id": "...", "verdict": null }
}
```

If the manager dies, it can cold-start from board plus `docs/project.md`; if a worker dies, it can recover from board plus `docs/log/<模块>-dev.md`.

---

## 16. Development order

Start by proving the most difficult and uncertain layer, then widen it.

| Milestone | Content | Validation |
|---|---|---|
| M0 | providers only supports Claude Code; crew MCP server; resident manager runtime; one development worker; board | Manager dispatches one module, hard completion check and event wake-up pass, everything resumes after DSH restart, and yellow permission requests reach the right side and can be approved |
| M1 | Review and integration flow; `crew.commit` gate; right-side list; long-session rotation | Section 17 items 3–8 and 10 |
| M2 | Codex adapter; roles page and capability validation; `crew.reassign` | Mixed role table with Claude manager and Codex development; change worker and continue |
| M3 | Grok and Gemini adapters according to capability investigation; quota queries; DeepSeek row | Section 17 items 1, 2, and 9 |

---

## 17. First-version acceptance

After Claude, Codex, and Grok are installed and logged in on this machine, with Antigravity and DeepSeek listed if detectable:

1. Settings can launch each provider login and show quota or “unknown” plus reset time.
2. A sample role table can be saved with Claude manager, Grok review, Codex GPT-5.6 Terra max development, and Codex GPT-5.6 Sol integration; missing capabilities or logins produce a save-time warning.
3. After opening a business repository, the manager prepares dependencies and scaffolding, then splits at least two modules; each module directory contains a README work order.
4. Two development sessions appear green in the top half of the right side and move to the uncolored bottom half after completion.
5. Telling the manager to change a completed module moves the same row to the top while preserving its shortened session ID.
6. Review rejection uses the original development session to repair without passing through the manager.
7. A worker needing a dependency pauses yellow; after the manager installs and appends, it continues.
8. Writing outside the guardrail turns yellow without an in-guardrail prompt; approval on the right continues the work.
9. Quota exhaustion or network loss stops the worker, and the manager explains why and presents two options; after the user selects another tool, a new session continues from `docs/log`.
10. Only the manager can commit through `crew.commit`; commit is rejected while a worker runs; records and tests under `docs/` and `tests/` remain present.
11. After closing and reopening DSH, the manager session continues and the right-side list agrees with board.
12. Every manager turn ends with a `等待：…` line, and progress events do not wake the manager.

---

## 18. Risk register

| ID | Risk | Mitigation | Status |
|---|---|---|---|
| R1 | Multiple workers share one worktree: A's tests can see B's incomplete work; lockfile and `node_modules` can change | Module test commands run only that module; full tests run only after all workers are done; manager confirms no running worker before dependency installation; modules never modify the same file. If interference persists, consider worktrees | No worktree by decision; observe |
| R2 | Claude Code recommends `--bare` for scripted calls and says it will become the `-p` default, but bare mode ignores subscription login and uses API keys. Current subscription-backed non-bare `-p` behavior is not a promise | Make “explicitly disable bare” configurable in the Claude adapter and monitor version changes | Confirmed; continue monitoring |
| R3 | Every wake-up consumes manager quota, and the example uses Claude Pro for the manager | Wake only for decision events, merge events, and avoid reading the full repository before delivery | Designed |
| R4 | Long sessions resend all history, and engine compaction does not guarantee memory | Long-session rotation plus handoff summary; disk contract remains primary | Designed |
| R5 | Capability gaps may prevent Grok or Antigravity from being workers | Probe capability matrix and disable unsupported roles | To confirm |
| R6 | Worker containment depends on engine guardrails plus prompts | Second layer: changed-path hard check, review scope check, and deny rules | Accepted by decision |
| R7 | Network changes can expire login and be misclassified as network failure | Use engine error categories to distinguish `authentication_failed` from connection errors; show a specific red reason | Designed |
| R8 | Vendor CLIs change arguments and event formats frequently | Keep all engine details inside provider adapters; crew consumes normalized events only | Structurally isolated |

---

## 19. Later work

- Art, modeling, and other trades: new roles plus new working directories, using the same session binding and right-side list.
- Add more engines through one adapter each; DeepSeek needs its own agent loop before it can be a worker.
- Role templates for quality-first and cost-saving modes.
- Worktree isolation as the R1 fallback.
