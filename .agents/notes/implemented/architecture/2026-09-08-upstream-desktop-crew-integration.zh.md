# Agent Note: Crew 与上游运行时的桌面整合

Status: implemented

[English](2026-09-08-upstream-desktop-crew-integration.md) | 中文

## 问题

桌面 Host、Session 持久化 API、可继续的 Subagent 实现和右侧栏独立于下游 Crew 工作流演进。文本合并不能证明工人来源、持久通知、任务关停和社区插件仍可通过交付组合运行。

## 决策

[官方桌面架构](2026-08-25-electron-desktop-packaging-and-updates.zh.md)负责独立桌面 profile 和私有 Fetch 通道。桌面安装与默认 Web profile 相同的 Crew Host 与 Client 组合包。[Crew Client](../../../../packages/client/ui-crew/README.zh.md)注册属于 Session 的右侧栏标签页；标签页保留工人选择，并复用现有只读工人观察器。 Desktop 保留组合包合成的 Agent 根目录，使随附的 `crew-manager` 与内置和自定义预设一起可选。桌面壳不以独立预设目录替换该列表。

可继续的工人在上游 Subagent 实现拆分后仍保留 Crew 所有的初始消息来源与结算通知否决钩子。Crew 通知送达确认已刷新的 inbox 插入；观察对应模型消息还需要 Agent 消费该插入。Session 读取使用官方句柄结果，并释放每个只读句柄。

[持久退出协议](../feature/2026-09-05-windows-tray-durable-exit.zh.md)继续负责任务准备与持久化。桌面退出、插件激活和更新不能静默丢弃活动任务。正常退出先准备并刷新，再终止进程树。重启操作拒绝活动工作，并保留其 Host 运行。

固定版本的社区用量插件通过 [pnpm 补丁](../../../../apps/desktop/patches/@ychris12138__dsh-usage-stats@0.2.9.patch)适配官方 Session 快照、句柄 API 和可信 Fetch 路由。浏览器 HTTP 请求保留插件基于 socket 的回环检查。只有私有 Fetch 适配器可以标记已经鉴权的请求；请求头不能提供该标记。缓存版本变化避免把旧游标语义与从零开始的事件偏移混用。 沙盒 preload 入口独立打包，因为 Electron 在此无法解析本地共享分块。当前 Cordis Client 配置求值器需要动态 JavaScript 求值；严格脚本 CSP 验证仍属于独立工作。

[桌面发行记录](../feature/2026-08-24-cross-platform-desktop-shell.zh.md)、持久退出记录与 [Crew 交付记录](../feature/2026-09-06-native-crew-default-delivery.zh.md)保留各自独立理由。[维护范围](../process/2026-09-05-windows-linux-maintenance-scope.zh.md)仍以原生 Windows 作为当前 Crew 阶段验收平台；保留的 Linux 和 macOS 辅助代码不构成原生验证证据。

## 考虑过的替代方案

- **用上游文件整体替换下游行为。** 这会丢失厂长来源、Crew 交付和保存任务后退出的协议。
- **保留第二个桌面后端。** 两个运行时所有者会在 profile、包安装和 Client 产物上产生分歧。
- **只为用量统计开放 HTTP 端口。** 私有通道已经提供鉴权后的请求；第二个监听器会增加独立暴露面与生命周期义务。

## 后果

兼容证据包括构建后的 Desktop Host 空闲与活动任务、私有管道用量请求、保留的 Session 日志、聚焦 Crew 工作流、侧栏注册，以及包和文档检查。依赖补丁绑定版本，用量插件采纳这些 API 时必须评审或移除。原生发布签名与安装包验证仍属于独立发布工作。
