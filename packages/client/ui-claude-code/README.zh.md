---
description: "在 DSH 设置中登录 Claude Code 并查看账号额度。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claude-code

[English](README.md) | 中文

## 概述

通过官方 Claude CLI 登录，在需要时提交授权码，取消待完成的登录，并在不发起模型请求的情况下刷新账号额度。主智能体与 Crew 智能体通过现有模型选择器选择 Claude Code。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[Web bundle](../../bundle/web-app/README.zh.md) 将本设置区与 [Claude 执行器](../../subagent/subagent-claude-code/README.zh.md) 一起挂载。打开设置 → Claude Code。已有原生登录会被复用；点击登录会运行官方授权流程。CLI 负责凭证，面板转交提交的授权码，并且不将其保留在 store 中。

刷新额度读取账号共享的时间窗口。每个窗口展示使用比例、重置时间和观测时间；缺失数据保持未知。打开账号控件会读取已登录账号的额度。打开会话或指定 Crew 角色本身不会启动 Claude 推理。客户端的 `loginPollMs` 配置只控制登录进行期间的轮询；默认值为 1000 毫秒。

Claude 会话在输入框下方展示上下文占用、缓存命中率以及五小时和七天额度。展开状态行可查看最近原生请求的输入、输出、缓存读取和缓存写入计数、模型容量及观测时间。上下文占用衡量最近请求，不代表累计 Token 消耗；原生压缩会清除前一次测量。模型容量可能需要等第一次请求完成后才能获取。状态行可见时，每隔 `quotaRefreshMs` 毫秒自动刷新共享额度，默认值为 60000，并提供手动刷新。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 执行器负责原生操作。生成的 Remote 方法传递公开的账号观测和登录输入。可释放的客户端控制器串行处理设置操作，轮询进行中的登录，并在卸载后拒绝迟到的结果。渲染器通过设置插槽绑定其 observable；组件只持有尚未提交的授权码草稿。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Claude Code 执行](../../subagent/subagent-claude-code/README.zh.md) — 原生运行时和账号行为。
- [Crew 设置](../ui-crew/README.zh.md) — 独立的角色选择。
- [Web Client 架构](../../../docs/subsystems/web-client.zh.md) — Remote 与插槽的归属。

-----

<a id="model-experience"></a>
## 模型体验

无，本 UI 包不添加模型可见内容、工具或提示词章节。所选执行器和 DSH 作用域工具组合决定 Agent 的请求。

#### KV Cache 影响

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

账号展示以原生 CLI 提供的观测为准。

- 固定版本的结构化额度命令仍为实验性；不兼容的响应会报错。
- 完成登录需要用户在官方浏览器页面授权。面板不能自动授权账号。
- 页面隐藏时暂停额度刷新；展示的时间戳可能过期。没有原生用量观测的旧 Session 在下一次 Claude 请求前显示未知请求计数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随插件。Host 负责账号和进程状态；本包负责展示与可释放的客户端注册。
