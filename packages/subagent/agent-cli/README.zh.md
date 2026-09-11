---
description: "原生 Grok、Antigravity 与 Codex 执行路由、账号控制及 DSH 工具执行职责。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-cli

[English](README.md) | 中文

## 摘要

Web profile 注册 `grok-cli`、`antigravity-cli` 与 `codex-cli` 执行路由，供主智能体和持久 Crew 成员选择。原生 CLI 管理认证及会话存储；DSH 管理工具调用、权限、结果与 Session。

## 目录

- [使用](#usage)
- [执行与续接](#execution-and-continuation)
- [账号与限制](#accounts-and-limits)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="usage"></a>
## 使用

安装原生 CLI 并按其正常流程登录，然后在对话模型选择器或 Crew 角色设置中选择提供方和已发现模型。`grokExecutable`、`antigravityExecutable` 与 `codexExecutable` 接受绝对路径覆盖；发现逻辑检查 Windows 原生安装位置及 PATH 可执行文件，不运行命令包装脚本。Linux 使用 PATH。不会自动安装、初始化 Git、重置账号或升级 CLI。

<a id="execution-and-continuation"></a>
## 执行与续接

每次原生调用返回结构化的正文及工具请求。DSH 在记录助手调用、通过已获准的回调执行工具前，先验证工具名和 JSON 对象参数。Grok 原生工具被禁用并拒绝。Antigravity 使用 `antigravityAgentRoot`（默认 `~/.gemini/config/agents`）下带 DSH 名称前缀的专用定义，只允许原生 `finish`，禁用 MCP 及自定义配置继承。发送提示前必须确认原生代理列表能发现此定义；观测到 `finish` 以外的原生工具调用时终止执行。`runtimeRoot` 下的私有工作目录保存协议文件，不指向用户项目。

持久检查点记录原生会话 ID、DSH 所有者、输入签名及已同步消息前缀。续接分别使用 Grok `--resume` 与 Antigravity `--conversation`；只有新建 Grok 会话才使用 `--session-id`。输入中断、系统指令或工具或模型变化、分叉及历史分歧均从 DSH 历史重新启动。输入输出字节上限会拒绝超限数据，不截断模型历史。完成、取消、超时及插件卸载都会清理原生进程范围。

Codex 使用原生 app-server stdio、持久 `thread/start` 及满足条件时的 `thread/resume`，通过 `turn/start.outputSchema` 约束相同的响应格式。模型发现提供可选推理强度。进程及线程配置禁用原生命令、钩子、插件、技能和继承的 MCP 条目；拒绝原生审批，并要求线程响应确认只读、禁网沙箱。意外原生条目会终止当前轮次。此路由不授予原生项目访问权限，也不使用 Git worktree。只读沙箱本身不能限制所有原生文件读取；模型负载下的实际工具隔离仍属于运行验收范围。

<a id="accounts-and-limits"></a>
## 账号与限制

`cliAgents` 提供原生模型刷新、受限且由用户控制的登录终端与缓存状态。Grok 模型列表可能在账号未能被辅助命令验证时返回本地模型；只有推理成功才在 DSH 确认账号可用。适配器不读取凭据文件。提供方正在执行时不能开始登录。

Grok 剩余额度保持未知。Antigravity 仅在用户操作后调用原生 `/usage`，使用受限的 DSH 原生代理，并拒绝非额度表格输出。需要原生文件访问的 CLI 版本无法通过此路由提供额度；查询可能消耗 CLI 请求，不会增加权限绕过参数。返回的剩余百分比转换为已用百分比，额度池与窗口按实际行数展示。调用计数与额度分开；Antigravity 累计用量相对已完成的原生检查点取差值。未提供上下文容量时保持未知。

Codex 账号及模型发现使用 `account/read` 与分页 `model/list`。手动额度刷新使用 `account/rateLimits/read`，不发起模型轮次或额度重置操作，保留全部实际额度池及可空的窗口、重置时间。令牌观测将线程累计计数与已完成检查点取差值；最新请求的总令牌数和实际模型上下文窗口描述上下文占用。缺失的原生计数及订阅调用成本保持未知。推理强度变化会使续接资格失效。

配置拥有 `runtimeRoot`、`antigravityAgentRoot`、显式 `env`、账号与请求与登录超时、输入输出字节上限及退出宽限。Crew 现有的提供方分组请求限制覆盖这些路由。本包没有独立 invariant 安装器：检查点资格和工具名称由执行器在作出决定时检查。

<a id="model-experience"></a>
## 模型体验

### 结构化原生执行

#### 模型看到的内容

原生模型收到已记录的 DSH 系统指令、作用域工具目录、序列化对话以及 `src/protocol.ts` 拥有的响应格式指令。原生工具不能替代 DSH 权限。本包不新增模型可见工具 schema。

#### Token 影响

新会话包含完整 DSH 历史和 JSON 响应协议。已同步续接仅发送新消息；只有签名变化、需要新建原生会话时才重发工具定义和系统文本。

#### KV Cache 影响

稳定的原生会话 ID 保留 CLI 复用缓存的机会。模型、系统指令或工具变化时有意新建会话；适配器不保证缓存命中。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

此路由在得到完整且有效的结构化结果后返回正文，支持文本和 DSH 工具。Codex 接受原生推理强度；媒体、温度、停止序列及输出令牌上限覆盖会被拒绝。不展示原生工具执行进度。按用户要求，本次交付未验证原生运行验收、负载下取消及 Session 录制回放。

## 开发说明

[子智能体子系统](../../../docs/subsystems/subagent.zh.md) 拥有共享执行概念。原生协议取舍及验证范围见 [Grok/Antigravity 决策](../../../.agents/notes/implemented/feature/2026-09-11-grok-antigravity-cli-adapters.zh.md)与 [Codex 决策](../../../.agents/notes/implemented/feature/2026-09-11-codex-cli-adapter.zh.md)。
