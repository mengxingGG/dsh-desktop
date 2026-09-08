---
description: "面向管理者、开发者、审查者与集成者的原生 Crew 作用域工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-crew

[English](README.md) | 中文

## 概述

`dsh-tool-crew` 在不接入外部 CLI 适配器的前提下向模型暴露原生 Crew 服务。Team Lead 获得仓库文件操作、工作流控制工具和全局记忆访问；Crew worker 只能获得持久任务授权的角色专用文件、声明测试与结构化报告工具。`crew_commit` 必须经过通用审批流水线，审批身份取自工具调用本身，只提交集成通过的路径，并且绝不推送。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 [`@deepseek-ai/dsh-crew-profile`](../../bundle/crew-profile/README.zh.md) 挂载这个 Consumer。profile 提供四种角色声明，同时保留厂长普通工具与预设。工人任务安装精确岗位工具。直接组合先挂载 Agent Teams 和 Crew，并启用 `requireRolePresets`，在加载时拒绝不完整角色配置。

### 工具集合

- **厂长**——`crew_read_file`、`crew_list_files`、`crew_write_file`、`crew_edit_file`、`crew_dispatch`、`crew_append`、`crew_stop`、`crew_status`、`crew_wait`、`crew_reassign`、`crew_integrate` 与 `crew_commit`。`crew_wait` 默认阻塞到下一次 Team 生命周期变化；`until: "manager-action"` 会跳过中间工人变化，直到需要干预、可以整合或已有终态整合结果。两种模式都会提示厂长重新读取状态，让一次性宿主无需轮询即可等待。
- **开发工人**——`crew_read_file`、`crew_list_files`、`crew_write_file`、`crew_edit_file`、`crew_run_test` 与 `crew_report`。
- **审查工人**——`crew_read_file`、`crew_list_files`、`crew_run_test` 与 `crew_report`；文件访问覆盖完整项目，但不能写入。
- **整合工人**——使用开发工具集合，拥有完整项目读写权限，用于整合修改和声明的组合测试。

厂长的 `crew_memory` 操作需要 Crew 偏好插件。读取返回当前 DSH 全局条目及其 revision。保存和删除使用该精确 revision；保存长期授权始终要求通用用户审批。偏好本身不会授予许可。

厂长在每轮首个继续执行的步骤（包括恢复的轮次）及轮次中记忆变化时，会收到已记录的 `crew-memory` 用户消息。每份快照明确替换之前的记忆快照；缺失条目撤销其记忆适用性，但不删除历史消息。偏好帮助判断，授权保留明确范围，危险操作仍需解释目标、影响和可恢复性。

所有注册都位于对应 Agent 的精确作用域，并随 Agent 或插件 generation 释放。Crew 服务继续负责角色绑定、revision 校验、路径限制、验证、恢复与提交资格。

当前整合仍在运行宿主验证时，厂长行动等待会保持挂起，即使原生整合工人已空闲。已审查模块和历史整合结果不会结束这次等待；暂停或失败工单仍允许厂长立即干预。

`crew_run_test` 在实际项目中运行厂长声明的命令，使用已安装依赖，并保留生成文件。工作目录检查、环境过滤、截止时间、输出上限和进程树清理仍由 Host 负责。这不是 OS 沙箱；[Crew 服务限制](../crew/README.zh.md#known-limitations-and-deferred-work)适用于每条声明命令。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`src/index.ts`](src/index.ts) 验证角色声明，贡献厂长与工人策略段，并且只在解析调用方的实时 Team membership 与 Crew binding 后注册工具。厂长操作调用 `ctx.crew`；工人文件与测试调用继续受持久任务限制。结果使用声明的 schema 与紧凑 JSON。`crew_commit` 是唯一会修改 Git 的入口，而且只有通用审批层准许同一个工具调用后，才会到达仅宿主可用的提交方法。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Crew 服务](../crew/README.zh.md)——持久工作流状态、宿主门禁、恢复与提交资格。
- [Crew profile](../../bundle/crew-profile/README.zh.md)——必需岗位与厂长增量组合。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-crew)——呈现给每种角色的精确 schema 与结果字段。

-----

<a id="model-experience"></a>
## 模型体验

### Crew 策略与工具 schema

#### 模型看到什么

厂长会收到固定 Crew 协调策略，以及[生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-crew)中的厂长子集。该策略陈述对每个厂长都相同的 Crew 机制，并列出启用 Crew 的三种情形：Agent 预设强制编排、用户要求组建开发团队，或工作能从独立实现与评审中受益。命中哪一种由所选 Agent 预设决定，而不由本插件决定——[`crew-manager` 预设](../../bundle/crew-profile/README.zh.md#role-presets)通过自己的 persona 以及不组合任何实现工具来强制编排，普通预设则保留工具与自行判断的余地。开发、审查和整合工人会收到固定工人策略，以及 `CREW_ROLE_TOOL_NAMES` 允许的 schema；若实时持久角色不再匹配该作用域，Crew 服务会拒绝调用。 厂长策略将 Git 视为本地开发的可选项，并遵守用户不提交代码的要求。派发、审查和整合无需初始化仓库、首次提交或远程访问。

#### Token 影响

每次 Crew Agent 请求携带一段稳定角色策略与该角色专属 schema。工具调用追加紧凑 JSON receipt、状态 view、有界命令输出或结构化证据；只有模型明确读取仓库文件时，文件内容才进入上下文。

#### KV Cache 影响

只要插件 generation、角色预设与角色 binding 不变，策略和 schema 前缀就保持稳定。任务提示、文件读取、工具结果与厂长通知追加在该前缀之后。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **预稳定 API**——模型 schema 与对应 Consumer 一起演进。
- **没有外部 CLI 适配器**——所有工人都是原生 DSH 可续接 Agent；provider 登录与额度表面不属于本包。
- **共享 checkout**——工具强制执行持久路径范围，但其他本地进程仍可修改 checkout，因此仍需要宿主验证。
- **提交必须审批**——`crew_commit` 只从通过整合的路径创建一次本地提交，并且永不 push。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

保持 `CREW_ROLE_TOOL_NAMES`、profile 角色 YAML、注册工具与生成目录行同步。加载会在任何 scoped 工具安装前拒绝漂移。

</details>

**运行时不变量：**不发布 companion。Crew 服务拥有这些 Consumer 使用的持久授权与证据关系。
