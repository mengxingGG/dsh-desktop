# Agent Note: Grok 与 Antigravity CLI 执行路由

Status: implemented

[English](2026-09-11-grok-antigravity-cli-adapters.md) | 中文

## 问题

主智能体和持久 Crew 成员需要使用原生 Grok 与 Antigravity 账号，同时遵守 DSH 工具限制。其 CLI 协议没有 Claude SDK 的进程内工具回调，已安装的 Antigravity 版本记录为完整结果正文。

## 决定

适配器扩展[外部 Agent 执行注册表](2026-09-09-claude-code-agent-execution.zh.md)。结构化响应包含正文和请求的 DSH 调用；DSH 在派发前验证并记录调用。Grok 原生工具被禁用。Antigravity 使用只允许原生 `finish` 的生成全局代理，不继承 MCP 或自定义配置；发送输入前必须确认原生发现能找到此定义。私有原生工作目录保存请求文件，不修改用户项目。[Codex 适配器](2026-09-11-codex-cli-adapter.zh.md)通过原生 app-server 协议使用相同响应格式；Claude 保留独立的回调实现。

原生检查点属于一个 DSH Session 和输入签名。续接仅发送新增消息；请求中断、模型或工具变化及历史分歧从已记录 DSH 输入重新启动。这保留 Crew 成员身份，不将原生会话 ID 视为充分续接证据。

原生 CLI 继续拥有凭据。设置提供显式原生登录终端与模型发现。Grok 目录诊断不能推翻用户确认可用的登录；执行成功前状态保持未知。Antigravity 额度查询仅手动触发，验证原生表格行，不添加无限制权限标志。提供方的单次调用成本不视为订阅剩余额度。

## 考虑的替代方案

直接调用订阅 API 会替代原生凭据管理。无限制原生工具会绕过 Crew 角色限制。完整 MCP 或 ACP 接线需要分别证明每个运行时的工具禁用和回调能力；结构化输出提供一个明确的 DSH 派发路径，同时保留原生认证。增量 JSON 会向用户暴露无效响应，因此首版在验证完整响应后返回正文。

## 验证与限制

实现进行了编译；按用户要求，自动化测试、真实模型请求、负载下原生取消与会话录制回放暂未执行。原生模型发现返回十四个 Antigravity 模型 ID。Grok 返回两个本地模型及辅助认证诊断；用户确认命令行账号可用。未执行登录重置或凭据修改。

对 AGY 1.1.27 的空输入检查发现，工作目录定义未被发现，而全局定义可列出并选中（`agentScript=true`）。即使选中了自定义代理，`init.tools` 仍列出总工具目录，因此不能用它判断有效权限。适配器检查发现结果与选中身份，声明仅允许 `finish`，并在观测到其他原生工具调用时终止。真实工具权限执行仍由用户验收。此路由初期支持文本、DSH 工具和完整响应；媒体与生成参数覆盖被拒绝。现有 Claude 执行和主智能体主导 Crew 记录继续分别拥有其职责。

## 来源

- [Antigravity 无头协议](https://antigravity.google/docs/cli/headless/)
- [Antigravity 自定义智能体规范](https://antigravity.google/docs/subagents)
- [Grok CLI 智能体协议](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)
