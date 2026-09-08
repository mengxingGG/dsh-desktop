# 外部智能体 CLI 接入调查

[English](agent-orchestration-cli-integration-research.md) | 中文

本文记录 2026-09-04 对 Claude Code、Codex、Grok 与 Antigravity 的本机调查和一手资料调查。它为后续接入选定协议，但不会把任何外部 CLI 放进 DSH 原生编排的第一里程碑。

## 摘要

第一阶段应让当前 DSH Agent 作为厂长，让 DSH 可续接子智能体作为工人。外部产品应在这套流程具备权威状态、可恢复能力和 Web 可见性之后，接入现有子智能体能力。Gemini CLI 不在范围内。

Claude Code 后续应通过流式 JSON 协议调用系统安装；`C:\Users\admin\Desktop\workspace\claudecodeDesktop` 中的固定二进制只作为协议参考。Codex 的持久交互工人应使用 `codex app-server`，Grok 应使用 ACP 服务，Antigravity 应在独立的官方 `agy` 无头 CLI 安装并登录后使用它。Antigravity 桌面程序的私有语言服务器不是接入面。

## 目录

- [决定](#decisions)
- [本机证据](#local-evidence)
- [DSH 现有基础](#dsh-baseline)
- [Claude Code](#claude-code)
- [Codex](#codex)
- [Grok](#grok)
- [Antigravity](#antigravity)
- [统一提供方义务](#normalized-provider-obligations)
- [建议接入顺序](#recommended-integration-order)
- [仍需取得的证据](#evidence-still-required)
- [资料来源](#sources)

<a id="decisions"></a>

## 决定

| 问题 | 决定 | 结果 |
|---|---|---|
| 第一阶段提供方 | DSH 原生厂长和工人 | 验证编排核心不依赖任何外部 CLI 进程。 |
| Gemini CLI | 排除 | 不得把 Gemini CLI 换名包装成 Antigravity 支持。 |
| Claude 可执行文件 | 解析用户的系统 Claude Code | 不得启动或复制 `claudecodeDesktop` 的固定二进制及其私有配置。 |
| Codex 持久传输 | `codex app-server` | 保持一条协议连接并使用 thread 和 turn 生命周期；`codex exec` 仅用于一次性降级或诊断。 |
| Grok 持久传输 | 基于 stdio 的 ACP | 扩展通用 ACP 可续接子智能体路径，不定义 Grok 专属转录事件。 |
| Antigravity 传输 | 官方 `agy` 流式 JSON | 不调用 Electron 应用内部的语言服务器。 |
| 身份认证 | 提供方自己的交互登录加只读预检 | DSH 不提取凭证，也不从桌面 UI 推断该产品 CLI 的登录态。 |
| 提供方 API | 宣告能力的可续接子智能体提供方 | 厂长、Crew 领域与 UI 不依赖提供方专属事件字段。 |

<a id="local-evidence"></a>

## 本机证据

以下观察是本机的时间点快照。调查没有读取登录密钥或认证文件内容。

| 产品 | 本机观察 | 接入含义 |
|---|---|---|
| Claude Code | 系统包装器为 `C:\Users\admin\AppData\Roaming\npm\claude.cmd`；版本 `2.1.251`；`claude auth status --json` 报告第一方 OAuth 已登录。 | 当继承的服务 PATH 缺少 `%APPDATA%\npm` 时显式解析系统包装器；继承用户的正常 Claude 配置。 |
| `claudecodeDesktop` | 其 Electron 桥启动内置 `claude-engine\claude.exe`，保持 stdin 开放，消费流式 JSON，回答控制请求，中断回合并恢复会话。 | 只借鉴协议与生命周期经验，不复用二进制、私有 `CLAUDE_CONFIG_DIR` 或打包运行时。 |
| Codex | 桌面程序附带的可执行文件报告 `codex-cli 0.153.0-alpha.5`；存在 `exec`、`resume`、`fork` 和 `app-server`。对该独立可执行文件运行 `codex login status` 返回“Not logged in”。 | 把桌面账户状态与独立 CLI 预检视为不同观察。后续适配器必须在派工前揭示这种不一致。 |
| Grok | `C:\Users\admin\.grok\bin\grok.exe` 报告 `grok 1.0.5`；提供 `agent stdio`、无头流式输出、续接、恢复、分叉、schema、沙箱与权限选项。 | ACP 在本机可用，是首选长驻传输。 |
| Antigravity | Antigravity Desktop `2.11.0` 安装在 `C:\Users\admin\AppData\Local\Programs\antigravity`。没有找到 `agy` 命令或预期的 `agy.exe`。 | 桌面程序可用不等于满足官方无头 CLI 前置条件。实现或端到端验证适配器前，应先安装并登录 `agy`。 |

可复用的 Claude 参考入口是 `C:\Users\admin\Desktop\workspace\claudecodeDesktop\electron\code-engine\spawn.js`、`electron\code-engine\protocol.js` 和 `electron\auth-manager.mjs`。它们展示传输分帧、进程控制和提供方自有认证委托，但不会让该项目的打包运行时成为依赖。

<a id="dsh-baseline"></a>

## DSH 现有基础

DSH 已经拥有大部分通用生命周期。[子智能体服务](../../../packages/subagent/subagent/README.zh.md)支持可续接子智能体、持久描述符、冷恢复、FIFO 追加、中断和发现。进程内 spawn 与 fork 提供方已经为 DSH 原生 Agent 实现这些生命周期。

当前外部提供方比目标产品窄。[Claude Code](../../../packages/subagent/subagent-claude-code/README.zh.md)与 [Codex](../../../packages/subagent/subagent-codex/README.zh.md)通过固定版本的 SDK 或运行时执行有界委派任务；[ACP](../../../packages/subagent/subagent-acp/README.zh.md)每次请求启动一个 ACP 进程。它们目前都不提供此处所需的进程复用式可续接运行、人工审批转发、持久提供方会话绑定、进度投影和 Crew 专属策略。

这是 API 集成任务，不是绕过当前能力接缝的理由。每个后续适配器要么实现 `prepareContinuable` 和现有生命周期，要么明确修改子智能体 API 及其全部消费者。

## Claude Code

### 支持的协议

官方无头接口支持 print 模式、流式 JSON 输入和输出、JSON Schema 输出、会话恢复与分叉、显式会话 ID、工具白名单、权限模式、附加目录、MCP 配置、系统提示扩展、预算上限和思考档选择。一个长驻进程可通过 stdin 接受多条用户事件，并发出 system、assistant、user、control 与 result 事件。

本机已安装版本确认了所需参数。`claudecodeDesktop` 桥还展示了两个值得固化为测试的生命周期细节：先写入第一条输入，再等待初始化；在回合之间保持 stdin 开放。控制请求必须收到控制响应，中断必须结束当前回合而不丢弃持久会话标识。

### DSH 适配决定

从配置的绝对路径或用户命令查找中解析 `claude.cmd`，验证 `claude --version`，然后在启用提供方前运行 `claude auth status --json`。不得设置 `CLAUDE_CONFIG_DIR`；系统安装必须继承用户已登录的配置。流事件被归一为 DSH 子智能体生命周期与审批事件，原始提供方字段只作为诊断结果元数据保留。

适配器不得复用 `C:\Users\admin\Desktop\workspace\claudecodeDesktop\claude-engine\claude.exe`。该项目只作为分帧、控制请求、取消和恢复行为的证据。

### 必须验证

- 通过系统二进制启动并完成一个两回合可续接任务。
- DSH 进程重启后恢复同一个提供方会话。
- 转发允许、拒绝和被中断的权限请求，同时不向工人暴露输入框。
- 证明提供方继承系统账户，且从不读取或持久化 token。
- 探测参数与事件变体，使版本变化以可操作的提供方诊断失败。

## Codex

### 支持的协议

`codex exec --json` 发出 JSONL 事件，并支持输出 schema、沙箱选择、附加目录、续接、恢复和分叉。它适合有界工作，也是有价值的一致性冒烟路径。

`codex app-server` 更适合作为持久传输。它通过 JSONL stdio 提供双向 JSON-RPC，从初始化开始，继续支持 thread 启动、恢复、分叉、turn 启动、流式 item 与服务端发起的审批请求。一个 Crew 工人自然映射到一个 Codex thread；每次追加映射到一个新 turn。

### DSH 适配决定

在提供方作用域内使用一个受监管的 app-server 进程，并把提供方 thread ID 持久化到 DSH 可续接子智能体描述符。DSH 负责重启、重连、thread 恢复、审批策略、中断和归一化投影。`codex exec` 保留为一次性降级和发布冒烟，而不是 Crew 的主运行时。

即使 Codex Desktop 已登录，本机独立二进制的“Not logged in”结果也必须作为提供方预检失败呈现。实现应确定并记录受支持的系统 CLI 安装和认证路径，而不是静默依赖桌面程序附带的可执行文件。

### 必须验证

- 初始化 app-server 并探测适配器使用的方法。
- 启动、追加、中断一个 thread，并在提供方进程重启后恢复它。
- 覆盖服务端发起的审批，验证已安装协议支持的一次允许、会话内允许和拒绝结果。
- 对允许模块和被拒绝的相邻路径证明沙箱与附加目录策略。
- 只有所选可执行文件的 `codex login status` 成功后，才运行已认证真实产品冒烟。

## Grok

### 支持的协议

已安装的 Grok CLI 通过 stdio 暴露 ACP 服务。官方实现记录了初始化、`session/new`、`session/prompt`、流式 `session/update` 通知、结构化消息/思考/工具更新和权限请求。它也提供无头流格式与续接参数，但 ACP 能避免另造一套 Grok 专属交互模型。

### DSH 适配决定

把现有 ACP 提供方扩展成可续接、受监管的会话提供方，并通过配置选择 Grok。能力发现来自 ACP 初始化。当标准 ACP 字段足够时，DSH 不得假设 xAI 扩展；提供方专属元数据不得泄漏到 Crew 领域。

不得启用无条件批准。已安装 CLI 的 `--always-approve` 只适合隔离的诊断夹具；产品行为必须组合 DSH 策略、提供方权限请求以及工人的路径和命令限制。

### 必须验证

- 为两次 prompt 保持一个 ACP 会话，并在协议允许时从进程故障恢复。
- 投影消息、思考、工具、权限和终态，同时不重复 Crew 事件。
- 拒绝一次越界写入，并证明拒绝结果持久且对厂长可见。
- 在加载时或最早可解析的派工点检测不支持的 ACP 能力。
- 不读取 `~/.grok/auth.json` 即运行一次真实已认证冒烟。

## Antigravity

### 支持的协议

受支持的自动化入口是独立的 `agy` CLI。其无头模式支持文本、JSON 与流式 JSON 输出、conversation ID、续接、显式会话选择、JSON Schema 输出，以及保持 stdin 的长驻流式 JSON 模式；每回合产生一个 result。

Antigravity 无头模式不提供交互式权限通道。受保护操作必须预先授权，否则被拒绝；文档说明发送 control request 或 response 事件会出错。因此，统一 DSH 能力声明必须报告该提供方不支持在线审批转发。

### DSH 适配决定

不得逆向 `resources\app.asar` 或调用桌面程序内部的 `language_server.exe`。这些组件使用私有启动参数和环回服务，并非有文档支持的外部接口。

只有这个后续适配器在 `agy` 安装且其自身认证预检成功前受阻；Crew 核心工作不依赖它。可用后，把 conversation ID 持久化为提供方会话绑定；进程健康时保持 stdin 开放，进程重启后通过会话恢复。

### 必须验证

- 独立于 Antigravity Desktop 探测 `agy`。
- 针对已安装版本确认认证、模型选择、一次性 JSON、长驻流式 JSON、续接、schema 强制与中断。
- 证明受保护调用遵循预配置策略，绝不等待不存在的交互审批通道。
- 适配器进程重启后恢复一段已记录会话。
- 只有 Antigravity Desktop 安装时明确失败。

<a id="normalized-provider-obligations"></a>

## 统一提供方义务

提供方接口应暴露经验证的能力，而不是让 Crew 按产品名分支。只有版本感知探测确认所需命令或协议方法后，某项能力才为真。

| 义务 | 含义 |
|---|---|
| 可执行文件解析 | 返回选中的绝对可执行文件、版本与来源；绝不静默换成内置二进制。 |
| 认证预检 | 不读取凭证地报告已认证、未认证、过期或未知。 |
| 续接 | 启动持久子智能体、追加回合、持久化不透明提供方会话 ID，并在宿主重启后恢复。 |
| 事件归一化 | 把提供方输出映射到生命周期、消息、工具、审批、错误、用量和结果事件，同时保留诊断元数据。 |
| 结构化结果 | 可用时请求提供方原生 schema 输出，并在进程或线协议边界验证结果。 |
| 策略 | 组合 DSH 工具筛选、文件系统与 shell 限制、提供方沙箱设置和审批行为。 |
| 取消 | 中断活动回合，执行有界关停，并保留或明确废止提供方会话。 |
| 背压 | 限制未消费输出，按子智能体串行追加，并在重连期间保持 FIFO 顺序。 |
| 错误分类 | 区分可执行文件、版本、认证、额度、网络、权限、协议、取消和模型故障。 |
| 可观测性 | 在 DSH Session 日志中持久化模型可见输入和归一化终态；把高容量原始诊断留在模型上下文之外。 |

<a id="recommended-integration-order"></a>

## 建议接入顺序

1. 完成并交付[编排核心开发步骤](agent-orchestration-core-development-plan.zh.md)中的 DSH 原生 Crew 流程。
2. 实现系统 Claude Code，因为其可执行文件和登录态已在本机验证，参考桌面项目也提供了经过实践的生命周期经验。
3. 升级通用 ACP 提供方，并把 Grok 作为第一个可续接外部配置。
4. 在本机解决独立 CLI 认证预检后实现 Codex app-server。
5. 安装并登录 `agy`，随后实现 Antigravity，且不增加任何 Gemini CLI 兼容层。

每个适配器都是独立变更，需要各自的 Agent Note、包文档、聚焦单元测试与进程测试、已认证真实产品冒烟，以及模型可见输出变化时的录制会话快照。不能因为 `--help` 列出了预期参数就合并适配器。

<a id="evidence-still-required"></a>

## 仍需取得的证据

本次调查没有发送付费模型任务，因此四个产品的真实回合行为、额度信号、审批往返和重启恢复均未验证。没有打开 Claude 或 Grok 的认证文件。Codex Desktop 登录态作为用户提供的上下文接受，而被检查的独立 CLI 报告了不同状态。本机未安装 `agy`，因此 Antigravity 结论来自文档证据而非运行时证据。

实现阶段必须重新运行版本和认证探测，捕获脱敏协议夹具，并在设置中宣传提供方前把每项生命周期主张转换成确定性测试。

<a id="sources"></a>

## 资料来源

- Claude Code [无头模式](https://code.claude.com/docs/en/headless)与 [CLI 参考](https://code.claude.com/docs/en/cli-reference)。
- OpenAI Codex [非交互模式](https://developers.openai.com/codex/noninteractive/)与 [app-server 协议](https://developers.openai.com/codex/app-server/)。
- xAI Grok [智能体模式](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)与[权限和安全](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md)。
- Google Antigravity [无头 CLI](https://antigravity.google/docs/cli/headless/)。

<details>
<summary>开发说明</summary>

本次调查有意只记录命令、版本和协议选择，不实现提供方。原始 [v0.2 方案](agent-orchestration-v0.2.zh.md)继续作为需求来源快照保留；本文取代其中的 CLI 能力假设。

</details>
