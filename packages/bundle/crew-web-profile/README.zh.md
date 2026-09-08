---
description: "在普通 DSH Web 对话旁显示原生 Crew 工人、实时记录和岗位设置。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-crew-web-profile

[English](README.md) | 中文

## 概述

`dsh-crew-web-profile` 为默认 Web profile 增加 Crew 工作台、全局岗位设置和 Crew 编排 Agent 预设。它位于 `@deepseek-ai/dsh-web-app` 和 [`@deepseek-ai/dsh-crew-profile`](../crew-profile/README.zh.md) 之后，普通及用户 Agent 预设全部保持可选，部署默认值不变。工人记录流式进入只读右栏，中央仍选中厂长对话。

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

默认 Web profile 已包含两个 Crew 层。自定义 Web profile 可以依次添加：

```sh
pnpm dsh plugin --profile web add ./packages/bundle/crew-profile
pnpm dsh plugin --profile web add ./packages/bundle/crew-web-profile
pnpm dsh web --profile web
```

Host 层提供 Crew 状态、Remote 方法、角色预设和模型工具。本 Web 层添加 Client Crew 插件和一个 roster root。对话、工具详情、审批与 Session UI 仍由 Web 应用 bundle 拥有。

### Crew 编排预设

预设列表新增**编排模式**（`crew-manager`），一个由 Host 层随附的只读 `system` 预设。选中它的会话运行一个始终以 Crew 编排工作的厂长：它的组合里没有 Shell、无作用域文件系统、子代理和工作流行，因此项目源码与测试只能由派发出去的 worker 修改。它保留协作面——询问用户、todo、Skills、计划模式和 compaction——与 Host 层安装的 `crew_*` 厂长工具并存。

部署默认值仍为 `standard`，所以这是逐会话的选择：普通预设保留完整工具集，并自行判断何时值得使用 Crew 协作。`dsh-agent-presets` 内置的四个预设排在前面且保持可选；后续 profile patch 若重述本行的 `roots`，Crew 预设就会从选择器中消失。

roster 行属于 `dsh-web-app`，所以在本 Web 层打补丁。只安装 Host Crew 层的 headless profile 没有 roster、也没有预设选择器，其厂长保留可自行判断的 Crew 策略。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 插入 `@deepseek-ai/dsh-client-ui-crew`，并用 `ctx.crewProfilePresets.agentPresetRoots` 给 `agent-presets` 行打补丁。patch 会替换目标行的整个 `config`，所以该行在新增 root 之外重述了 `default: standard`。[`src/index.ts`](src/index.ts) 是无行为模块入口，因为有序 patch 才是本包的运行时内容。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Crew Host profile](../crew-profile/README.zh.md)——必需的原生工作流与角色组合。
- [Crew 浏览器 UI](../../client/ui-crew/README.zh.md)——面板投影、选择与只读行为。
- [Web 应用 bundle](../web-app/README.zh.md)——本层扩展的稳定浏览器组合。

-----

<a id="model-experience"></a>
## 模型体验

通过 Host Crew profile 拥有的协作策略和工具间接产生影响；浏览器层不贡献模型提示。

#### KV Cache 影响

除 Host Crew 策略与所选 Agent 预设外没有影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **有序组合**——base、Web 应用、Crew Host 与 Crew Web 层必须保持这个顺序。
- **roster 行是重述而非合并**——部署若要改默认预设或增加自己的 root，必须在本层之后给 `agent-presets` 打补丁并重述每个键，包括本层的 root。
- **厂长拥有工作流**——工人控制仍位于厂长对话中。
- **工人只读**——浏览器暴露证据，不提供工人导航或子 Session 输入框。
- **仅原生 provider**——外部 CLI 适配器不属于本层。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：**本包不发布 invariant companion，因为它只拥有静态 profile 组合；Crew 服务负责验证运行时关系。
