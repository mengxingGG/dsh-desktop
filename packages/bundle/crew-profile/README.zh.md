---
description: "为 DSH profile 增加原生 Crew 岗位、受限工人、持久证据和宿主验证。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-crew-profile

[English](README.md) | 中文

## 概述

`dsh-crew-profile` 为用户选择的 DSH Agent 增加原生软件团队协作。默认 Web profile 已包含本层；自定义 profile 可以将它添加到基础和应用 bundle 之后。厂长的普通工具和 Agent 预设保持可用，本包另外随附一个 Agent 预设，选中它的会话被强制以 Crew 编排工作。开发、审查和整合工人分别使用可独立配置的模型与任务专用工具。

## 目录

- [使用本包](#use-this-package)
- [角色预设](#role-presets)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在已经初始化的源码 checkout profile 中，把本层添加到基础 bundle 和应用 bundle 之后：

```sh
pnpm dsh plugin --profile headless add ./packages/bundle/crew-profile
pnpm dsh --profile headless "Plan two independent modules, dispatch the native Crew, and report verified results."
```

厂长 Session 的 cwd 就是仓库根。本层在第一次使用 Crew 时记录该根，最多允许四名并发工人，只接受 `pnpm`、`npm` 和 `node` 作为声明的验证程序，并要求在具名分支上执行本地提交。部署值应通过额外 profile patch 覆盖；同一个厂长 Session 中已经持久化的 Crew 配置保持不可变。

<a id="role-presets"></a>
## 角色预设

本包拥有四个必需 YAML 角色预设。厂长工具补充用户选择的 Agent 预设。开发工人获得模块范围文件权限、共享 `docs`、`test`、`tests` 目录、声明测试和报告工具。审查工人可以读取完整项目并运行声明测试；整合工人还可以写入整合修改。工人预设先清除继承工具，再安装精确角色工具，允许覆盖 provider、model 和 reasoning effort。

`crew-manager` Agent 预设就是强制 Crew 编排的那个。它的组合本身即强制手段：persona、仓库指令，加上一层协作面——询问用户、todo、Skills、计划模式和 compaction——除此之外别无他物，因此运行它的会话没有任何 Shell、无作用域文件系统、子代理或工作流工具可以绕开 Crew 工作流修改项目代码。厂长 persona 陈述同一件事，加载器逐字节比对这两段文本。要增加能力就得同时改组合与 [`src/index.ts`](src/index.ts) 里的模块白名单；任何命名了白名单之外模块的行都会使加载失败，嵌套在 group 内部的行也一样。

选不选这个预设是用户的逐会话决定。任何普通预设都保留完整工具集和可自行判断的 Crew 策略，部署默认值也停留在那里。把 `presets/agents/` 发布到 Web 预设列表的是 [`@deepseek-ai/dsh-crew-web-profile`](../crew-web-profile/README.zh.md)；本 Host 层只把该目录暴露为 `ctx.crewProfilePresets.agentPresetRoots`。角色声明缺失或不一致会使加载失败。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`src/index.ts`](src/index.ts) 验证角色预设并发布 `ctx.crewProfilePresets`。[`cordis.patch.yml`](cordis.patch.yml) 添加 Team、Crew、偏好设置、不变量和 Crew 工具插件，不替换普通工具行或根 persona。厂长 Session event 与子 Session descriptor 仍是权威记录。

| 路径 | 职责 |
|---|---|
| [`presets/roles/`](presets/roles/) | 四种角色的精确 persona、工具、路由、筛选和深度声明 |
| [`presets/agents/crew-manager/`](presets/agents/crew-manager/) | 强制 Crew 编排的 Agent 预设 |
| [`src/index.ts`](src/index.ts) | 启动验证与 `ctx.crewProfilePresets` provider |
| [`cordis.patch.yml`](cordis.patch.yml) | 应用在所选应用 bundle 之上的有序 Host 组合 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Crew 服务](../../subagent/crew/README.zh.md)——持久阶段、证据、恢复与宿主操作。
- [Crew 工具](../../subagent/tool-crew/README.zh.md)——精确的厂长与工人模型工具。
- [Crew Web profile](../crew-web-profile/README.zh.md)——只面向厂长的浏览器层。
- [原生 Crew 开发步骤](../../../docs/developer/discussion/agent-orchestration-core-development-plan.zh.md)——第一阶段产品范围与验收。

-----

<a id="model-experience"></a>
## 模型体验

### Crew 角色组合

#### 模型看到什么

根模型保留所选 persona 与普通工具，同时获得 Crew 协作策略、已记录的 DSH 全局记忆和 `crew_*` 厂长 schema。该策略陈述 Crew 机制并列出何时该启用 Crew；具体命中哪一种由所选预设决定，因此运行 `crew-manager` 的会话读到的是强制编排的 persona，而普通预设保留自行判断的余地。子模型收到自己的角色 persona、持久任务和岗位工具。需要处理的 Crew 通知在厂长当前回合结束后以持久用户消息进入上下文。

#### Token 影响

厂长承担一次固定 persona 与策略成本以及厂长 schema 成本。每名工人承担其角色 persona、被委派 Agent 安全文本、角色 schema 与一条可变任务的成本；后续工具结果和修复提示会追加到该工人的历史中。

#### KV Cache 影响

只要 profile、角色预设与所选模型路由不变，厂长和工人的前缀就保持稳定。工单、证据与通知追加在这些前缀之后。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **预稳定 API**——profile 与角色声明可能随对应 Consumer 一起变化。
- **共享 checkout**——角色隔离依赖互斥仓库范围与宿主验证；本 profile 不创建 worktree。
- **仅原生工人**——外部 CLI provider、其登录状态与额度展示不属于本层。
- **仅本地提交**——`crew_commit` 需要审批决定，而且永不 push。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

角色声明必须与 `CREW_ROLE_TOOL_NAMES` 保持同步；profile 加载会有意拒绝漂移，而不是静默削弱角色。

</details>

**运行时不变量：**本静态组合包不发布 invariant companion，因为它只拥有已验证的 profile 输入。Team 与 Crew 包拥有可独立观察的运行时关系。
