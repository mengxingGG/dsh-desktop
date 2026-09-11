---
description: "基于 Agent Teams 任务、可续接 DSH 工人、持久证据和宿主验证的原生 Crew 工作流。"
kind: "package-reference"
---

# @deepseek-ai/dsh-crew

[English](README.md) | 中文

派发默认使用 `reviewMode: "manager"`：按大块职责委派，通过 `append()` 复用开发子智能体，由主智能体负责审查、修复和集成。独立审查按需启用。自动修复默认次数为零；默认允许两个活跃工单，暂停和可集成工单不占名额。

主智能体执行 `integrate()` 时必须提供 `reviewSummary`，可提供额外 `changedPaths`。修复前先停止相关子智能体。本次完整的 `testCommands` 验证当前文件，可修正先前的命令声明。证据记录主 Session，不创建审查子智能体，也不宣称独立审查。验证失败时保留文件供重试。`execution: "worker"` 保留独立审查后的专门集成路径。

Host 的 `maxConcurrentRequests` 默认为每个提供商分组两个请求，包含主智能体。`providerRequestLimits` 覆盖分组上限，`providerRequestGroups` 合并共享账号的路由。外部执行在工具运行期间释放名额，因此等待中的主智能体不会阻塞子智能体请求。

## 概述

通过持久软件工单协调原生开发、独立审查和整合工人。Crew 把工单绑定到 Agent Teams 任务，在厂长 Session 中记录修订与证据，并通过 `ctx.sessionProjections` 重建。Agent Teams 拥有成员、消息、任务所有权和依赖；子 Session 拥有工人记录。

## 目录

- [使用此包](#use-this-package)
- [持久状态](#durable-state)
- [全局记忆与岗位模型](#global-memory-and-role-models)
- [当前实现](#current-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

应在 Agent Teams、Session 持久化与投影、子智能体服务之后加载它。厂长 Session 是隐式 Crew 根。`ensureConfigured()` 只记录一次解析后的仓库根与原生角色预设；`createWorkItem()` 在精确范围与命令验证后绑定现有 Team 任务；`updateWorkItem()` 应用比较并设置状态转移，并检查对应 Team 任务状态。

产品组合属于 Crew profile 包和默认 Web profile；应用通过 `dsh` 启动。

本地开发只需要项目目录。派发、验证、审查和整合无需 Git 仓库或首次提交即可运行，Crew 不会为这些操作初始化仓库或连接远程。创建本地提交是可选操作，需要单独获批，且目标必须是已有提交的 Git 仓库。

通知合并、工人回合、进程宽限、Git 截止时间和声明测试截止时间接受正整数毫秒，上限为 `dsh-timeout` 的 `MAX_TIMER_DELAY_MS`。部署验证和 Session 回放会拒绝更大值，避免 Node 将其压缩为 1 毫秒。宿主操作使用厂长 Session 记录的执行限制，即使重启后的部署默认值不同也不例外。

<a id="durable-state"></a>
## 持久状态

厂长 Session 保存 `crew/configuration`、`crew/work-item`、`crew/report`、`crew/verification`、`crew/review`、`crew/integration`、`crew/notification` 和 `crew/commit` event。回放会完整验证当前版本载荷。工单与整合使用连续 revision；闭合阶段表拒绝非法边；通知在交付重试间保留同一个稳定用户消息 id。

不存在 `board.json` 或进程内工作流数据库。仓库文件只是工作产物与验证输入。

[桌面退出准备](../../../.agents/notes/implemented/feature/2026-09-05-windows-tray-durable-exit.zh.md)会在 Agent 会话关闭前排空 Crew 宿主工作并停止通知调度。准备开始后 Crew 拒绝新的管理工作；已有持久工单与工人记录保留，供重启时核对。

<a id="global-memory-and-role-models"></a>
## 全局记忆与岗位模型

`/preferences` 插件向现有 [DSH 设置提供方](../../settings/settings-file/README.zh.md)注册 `crew-preferences`。操作偏好、明确限定范围的授权和四岗位模型默认值属于用户的 DSH home，与当前仓库无关。项目规格、任务进度与 transcript（文本记录）保持其项目和 Session 归属。

`CrewPreferences` 限制记忆条目数量和文本大小，验证成对的提供方/模型选择，并按设置 revision 检查编辑。新工人只解析一次岗位默认值，并将这些选项保存在可续接描述符中；返工和冷恢复保持该绑定。厂长工具 Consumer 将当前记忆作为有日志记录的上下文提供，并在首次请求应用厂长默认模型。[Web 设置页](../../client/ui-crew/README.zh.md#global-settings)支持用户直接编辑和删除。条目删除后，历史 Session 消息仍会保留。

<a id="current-implementation"></a>
## 当前实现

Crew 文件工具拒绝符号链接，以及硬链接数量不恰好为一的普通文件。无法报告该数量的后端不能授权 Crew 文件访问。这些路径检查并不隔离无关宿主进程对 checkout 的并发修改。

服务会派遣 DSH 原生可续接开发工人，为有界修复续接同一个子 Session，启动独立审查者与可编辑的整合者，并在重启后核对活动记录。每次开发交接之后都执行宿主拥有的产物、路径和精确命令验证。需要处理的终态变化在当前厂长回合之后成为持久消息；进度变化只更新实时投影。本地提交会重查完全停稳的 checkout、通过的整合、审批身份和精确暂存路径，而且永不推送。

验证保留声明测试结束后观察到的 checkout。审查完成和整合准入拒绝陈旧的模块输入、规格、HEAD 或分支。整合允许报告中列出的跨模块编辑，验证其精确变更路径，并拒绝组合测试期间的进一步 checkout 变化。开发者互斥范围内的无关修改不会使单模块验证失效。

Checkout 摘要绑定已变化路径的内容、文件类型与权限位。链接只贡献链接文本，不读取目标文件。Checkout 读取在计算后代路径哈希之前拒绝链接形式的父目录，并拒绝需要规范化空白或分隔符的 Git 路径写法。只有文件系统观察到的缺失才成为删除证据；Git 哈希失败、Git 输出截断或采集期间文件变化都会拒绝该观察结果。Git 写操作分别保留退出结果与诊断截断结果，随后通过读取 checkout 确认持久结果。

Checkout 摘要还包含 Git 索引的逻辑条目。采集过程拒绝索引条目变化，但允许正常的文件状态缓存刷新。整合与提交比较完整摘要；获批的暂存步骤单独比较工作文件证据。隐藏已跟踪文件变化的索引标志会导致拒绝，Crew 不会修改这些标志。重试前需在 Crew 外清除 `assume-unchanged` 和 `skip-worktree`。

没有根目录 `.git` 或分支尚无提交时，Crew 使用本地文件摘要。`execution.ignoredDirectories` 默认排除 `node_modules`、`.npm-cache`、`.pnpm-store`、`dist`、`build`、`coverage` 和 `.next` 目录；`.git` 和 `.env` 始终受保护。此本地清单规则不排除 Git 跟踪文件。

声明命令通过现有子进程提供方在实际项目中运行，使用已安装依赖，并保留生成文件。宿主验证真实工作目录，过滤凭据环境变量，限制输出与截止时间，并等待受管进程完成。Windows npm/pnpm Node 包装脚本解析到已安装的 JavaScript 入口，不经过 shell 插值。此执行器不强制执行 OS 文件系统或网络隔离。

开发者文件访问覆盖任务模块路径和已配置共享目录，默认共享 `docs`、`test` 与 `tests`。审查者读取完整项目并运行声明测试，不进行编辑。整合者读写完整项目，报告每项额外编辑，并运行组合测试。所有文件操作保留凭据、Git 内部路径、路径穿越和别名检查。

[岗位策略与全局记忆决策](../../../.agents/notes/implemented/feature/2026-09-05-crew-role-policies-and-global-memory.zh.md)负责这些策略。普通[子进程提供方](../../subprocess/subprocess-local/README.zh.md)负责平台进程树清理。

<a id="model-experience"></a>
## 模型体验

### 工人任务与厂长通知

#### 模型看到什么

每名原生工人都会收到宿主生成的任务，其中包括 `moduleKey`、规格路径与 revision、允许的读写范围、必需产物、声明的测试命令，以及结构化报告要求。厂长会收到持久 `crew-notification` 用户消息，了解需要处理的工人、审查与整合结果。专用 Crew 工具 Consumer 负责工具 schema 与稳定角色策略。

#### Token 影响

每名新工人的历史会加入一条任务，修复指令则进入同一个持久开发工人历史。合并后的厂长通知只增加终态摘要和稳定证据身份；仅表示进度的 Crew event 不进入模型上下文。

#### KV Cache 影响

角色提示与工具 schema 由 profile 和工具 Consumer 拥有。本包的任务与通知追加在这些可复用前缀之后；其中可变的规格、范围、revision 与证据字段不会使更早的前缀失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- API 处于预稳定阶段；当前 event 世代为版本 1，已发布 Session 数据遵循相邻迁移规则。
- 外部 CLI 提供方、提供方登录、额度展示、worktree、分布式工人和用户直接与工人对话都不属于第一阶段。
- 共享 checkout 要求任务模块写范围互斥；共享文档和测试仍需协调。任意测试脚本不受文件工具路径检查的约束。
- Windows 项目执行通过已安装的 Node 和 npm 运行时测试。这些证据不验证 Linux、WSL 或 macOS 执行。
- 测试工具只接受厂长声明的命令和配置的程序名。额外操作需要独立的厂长协调；原生测试执行器不是通用权限或 OS 沙箱引擎。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

遵循[原生 Crew 开发步骤](../../../docs/developer/discussion/agent-orchestration-core-development-plan.zh.md)和已实现的 [Crew Agent Note](../../../.agents/notes/implemented/feature/2026-09-04-dsh-native-crew-orchestration.zh.md)。通用成员表、信箱、任务与子智能体生命周期行为继续留在当前所有者中。

</details>

**运行时不变量：**[`./invariant`](src/invariant.ts) 比较可独立观察的 Crew 工单与 Team 任务、成员和当前子 Session 绑定。投影内部 revision 与状态转移检查留在投影中。
