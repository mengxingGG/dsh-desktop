# Agent Note: Windows 和 Linux 桌面壳与安装运行时

Status: implemented

[English](2026-08-24-cross-platform-desktop-shell.md) | 中文

## 问题

桌面开发可以复用已构建检出目录，分发则必须携带自己的 Node.js、包管理器和依赖图。每次开发构建都复制完整运行时代价较高；依赖开发者检出目录会让安装包无法在其他位置使用。

## 决策

Electron 壳复用 Web 应用与插件组合。[上游整合决策](../architecture/2026-09-08-upstream-desktop-crew-integration.zh.md)负责私有 Desktop Host 及其 Crew 兼容性。[打包架构](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)负责独立 profile、离线种子和内置运行时。

开发通过可丢弃的链接桌面项目使用已构建工作区。打包应用使用内置 Node.js 与 pnpm，把精确版本安装到自己的 profile。[桌面 README](../../../../apps/desktop/README.zh.md)负责启动与打包命令。

Windows 是主要验收平台，Linux 次之。保留 Linux x64 目标选择；原生安装与运行时验证遵循[维护范围](../process/2026-09-05-windows-linux-maintenance-scope.zh.md)。保留的 macOS 源码与辅助命令不构成下游原生测试或发布承诺。

桌面壳保留上下文隔离、Chromium 沙箱与渲染器禁用 Node 集成。[持久退出协议](2026-09-05-windows-tray-durable-exit.zh.md)区分隐藏窗口与停止任务、保存历史。

## 考虑过的替代方案

- **分叉 Web UI。** 两套呈现实现会让设置、profile 与插件 slot 漂移。
- **在 Electron 的 Node 进程内运行后端。** 原生窗口生命周期、后端子进程和插件依赖会共享故障域。
- **每次开发构建都复制完整运行时。** 已构建检出目录已经拥有依赖图；打包保持为显式步骤。
- **发布未经验证的平台。** 生成安装包不能证明原生启动、关停或插件安装行为。

## 后果

开发桌面壳依赖检出目录；安装包依赖完整的内置运行时。平台验证必须对应当前打包实现。历史产物不能证明新合并的运行时可以正确安装或启动。
