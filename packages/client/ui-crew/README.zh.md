---
description: "在厂长对话的右侧栏中查看实时 DSH 原生 Crew 状态、工人证据、整合与提交结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-crew

[English](README.md) | 中文

## 概述

在厂长对话旁查看活动与已结束工人，以及验证、审查、整合和提交证据。Crew 设置页可以独立选择四个岗位的模型，并让用户查看、编辑和删除 DSH 全局操作记忆。工人证据保持只读；面板没有工人输入框。

## 目录

- [使用本包](#use-this-package)
- [面板行为](#panel-behavior)
- [全局设置](#global-settings)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 [`@deepseek-ai/dsh-crew-web-profile`](../../bundle/crew-web-profile/README.zh.md) 挂载本包；该 profile 提供 Host Crew 服务与仅厂长 Agent 预设。Host 包入口没有行为，Web Client loader 挂载 `/client`。本包没有 Client 配置字段。

<a id="panel-behavior"></a>
## 面板行为

标题栏操作只出现在根厂长 Session。徽标统计尚未进入 `accepted`、`failed` 或 `cancelled` 的工单。打开面板会选中右侧栏的 Crew 标签页。每个 Session 保留自己的工人选择，工具详情和工作区文件仍可从相邻标签页打开。

面板分隔线与中性描边使用共享主题的 0.5px 细线。

面板从持久 Crew 值派生厂长注意状态与阶段标签。选择工人后会显示缩短的子 Session id、原因、变更与拒绝路径、缺失产物、结构化报告、有界命令结果和审查问题。整合与提交卡片只显示已记录的宿主证据。载入、重连、不可用、空状态和回放失败互不混淆，中英文文案通过 locale 服务注册。

验证与整合命令通过可用键盘操作的折叠区展开。每条命令分别显示已记录的工作目录、退出码、信号和超时状态。标准输出与标准错误各自使用纯文本区域，支持键盘滚动并限制显示高度；空输出与宿主截断有不同提示。打开日志不会执行命令或联系工人。

审查详情保留冻结的规格修订、轮次、审查者、验证引用，以及每个问题的预期修正。整合详情在测试和问题旁展示冻结的工单输入。提交证据保留完整审批与整合引用、请求路径，以及已记录的哈希或拒绝原因。请求路径不能证明已经暂存：checkout 漂移可以在 Git 暂存之前拒绝请求。

<a id="global-settings"></a>
## 全局设置

设置对话框的**智能体编排**页面通过 Host 的 `crew-preferences` 命名空间保存岗位默认值与操作记忆。数据属于 DSH 用户设置，不属于所选项目或浏览器存储。已有厂长和工人 Session 保持模型绑定；新 Session 解析当前岗位默认值。模型目录中消失的已选模型仍可查看和移除。

记忆条目区分操作偏好与明确限定范围的长期授权。保存授权需要用户专门确认；过去多次批准不是许可。编辑保留打开编辑器时观察到的 revision，因此不能覆盖并发更新。删除需要确认，影响后续记忆读取，不修改历史 Session 日志。非本机浏览器的内存模式和不可写 Host 设置禁用写入。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

Client mount 注册 locale 字典、对话标题栏操作、`sidebarRightTabs` 项及其 `sidebar.right.pane.tab` 内容。`useProjection('crew')` 读取由稳定 Client Session 层分发的 Session 投影；本包不轮询 Host，也不保存第二套工作流状态。每项注册都是 effect，并随插件 fiber 卸载而移除。

工人活动通过附加 Session 观察复用现有 Chat 投影，显示流式文本、推理、工具调用、结果、错误和分页历史。打开记录不会选中子对话或启动模型回合。切换工人或关闭详情会释放观察；重新打开从持久子历史读取。视图默认显示最近 100 个节点，按需展开历史。

| 文件 | 职责 |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Locale、标题栏操作与类型化详情分支注册 |
| [`src/client/CrewAction.tsx`](src/client/CrewAction.tsx) | 仅厂长触发器与活动工单计数 |
| [`src/client/CrewDetailsView.tsx`](src/client/CrewDetailsView.tsx) | 实时只读投影与证据呈现 |
| [`src/client/activity.ts`](src/client/activity.ts) | 附加子 Session 观察与历史分页 |
| [`src/client/WorkerActivity.tsx`](src/client/WorkerActivity.tsx) | 只读流式工人记录 |
| [`src/client/CrewSettings.tsx`](src/client/CrewSettings.tsx) | 四岗位选择器与显式记忆编辑 |
| [`src/client/preferences.ts`](src/client/preferences.ts) | 设置范围写入与带 generation 校验的模型目录 |
| [`src/client/selection.ts`](src/client/selection.ts) | 类型化 Crew 详情选择 |
| [`src/client/locales.ts`](src/client/locales.ts) | 键完整的中英文产品文案 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Crew Web profile](../../bundle/crew-web-profile/README.zh.md)——增量扩展默认 Web 组合。
- [Crew 服务](../../subagent/crew/README.zh.md)——权威投影与证据语义。
- [右侧栏](../ui-sidebar-right/README.zh.md)——Session 所有的标签页导航与选择。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册模型提示、工具或用户消息。设置控件会修改 Host 拥有的默认值和记忆；[Crew 工具 Consumer](../../subagent/tool-crew/README.zh.md#model-experience)负责其有日志记录的模型上下文影响。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **证据只读**——修复、换人、整合和提交仍由厂长对话中的工具操作完成。
- **只展示保留输出**——面板显示宿主保留的输出，逐条标注被截断的流，不能恢复已丢弃的字节。
- **仅根 Session**——子 Session 不显示触发器，也不能把此面板用作对话切换器。
- **没有外部 provider 展示**——provider 认证、额度或 CLI 进程详情不属于原生 Crew 阶段。
- **单工人视图**——选择另一名工人会释放上一个实时观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：**不发布 companion。Crew 投影和设置 revision 保持现有归属；本包负责呈现与可释放 Client 注册。
