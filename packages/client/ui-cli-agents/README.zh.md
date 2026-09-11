---
description: "对话输入框附近的原生 CLI 账号设置与调用计数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cli-agents

[English](README.md) | 中文

## 摘要

添加 Grok、Antigravity 与 Codex 的外部 CLI 设置页面，并在使用这些路由的对话下方显示原生调用计数。[Host 执行器](../../subagent/agent-cli/README.zh.md)拥有账号与执行行为。

## 目录

- [账号控制](#account-controls)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

<a id="account-controls"></a>
## 账号控制

打开设置时刷新可用模型，不发起推理。Client 配置 `loginPollMs` 控制原生登录期间读取缓存终端状态的间隔。登录仅在用户操作后开始，显示有大小限制的原生终端输出、授权链接，以及显式输入、光标和回车控件。关闭登录会清理终端并刷新模型。凭据保留在原生 CLI。Grok 辅助目录命令不证明账号已退出；未验证认证时显示未知。

Antigravity 额度查询仅手动触发，并说明可能消耗请求。Grok 额度不显示虚构进度条。原生用量来自持久化 `cliUsage` 投影；未提供的计量保持未知。本包没有独立运行时 invariant：账号生命周期和执行状态属于 Host。

Codex 手动额度查询不需要模型请求，展示实际账号额度池和重置时间；未提供重置时间时保持未知。模型选择器使用原生模型目录和推理强度。输入框附近显示最新调用的输入、输出和缓存输入，并在原生提供时显示上下文占用及容量。缓存额度对应最近一次手动查询。

<a id="model-experience"></a>
## 模型体验

无，因为设置和输入框插槽不添加模型可见内容。所选 Host 执行器拥有原生提示词与工具。

#### KV Cache 影响

无。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

原生登录输出以有大小限制的文本显示，不是完整终端模拟器。Host 可能拒绝不可用的原生额度命令。本次交付仅有编译证据；浏览器与真实账号验收留给用户。

## 开发说明

[Web Client 子系统](../../../docs/subsystems/web-client.zh.md)拥有插槽与 Remote 约定。
