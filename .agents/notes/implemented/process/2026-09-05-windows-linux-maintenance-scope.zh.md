# Agent Note: Windows 与 Linux 维护范围

Status: implemented

[English](2026-09-05-windows-linux-maintenance-scope.md) | 中文

## 问题

维护者拥有 Windows 设备，但没有 Mac。主动开展 macOS 开发和原生发布验证会消耗时间，却没有可用于复现用户故障的本地设备。托管构建成功不能替代这种维护能力。

## 决定

Windows 是主开发与验收平台，Linux 为辅助平台。macOS 不承担主动开发、原生测试、兼容适配或发布承诺。已有兼容代码、本地构建辅助工具和历史产物保持不变。可以考虑可复现的 macOS 问题及贡献者修复，但不把该平台作为 Windows 或 Linux 工作的前置要求。

当前 [Crew 开发阶段](../../../../docs/developer/discussion/agent-orchestration-core-development-plan.zh.md)在原生 Windows 上验收。本地 Linux/WSL 环境恢复、全量回放及兼容修复延后，不阻止该阶段交付。Windows 仍需完整的功能与安全证据，包括原生子进程路径。这项优先级调整不禁用现有 Linux CI，也不证明 Linux 正确；只有在合适宿主上明确重新纳入范围后，才开展 Linux 验证。

GitHub Actions 与 GitLab CI 只选择 Windows x64 和 Linux x64/arm64 运行时构建。Python 发布集合包含这三个运行时 wheel 和一个纯 SDK wheel。可复用工作流拒绝其他目标输入。macOS 串行参考任务、Seatbelt CI 分支和 Landlock macOS 降级任务均不存在；底层源码实现保留。这次本地配置修改不会启动任何托管工作流或发布。

本决定仅替代[串行 CI 参考](2026-07-21-serial-cross-platform-ci-reference.zh.md)、[已安装 wheel 验证](../testing/2026-08-23-installed-python-wheel-black-box-ci.zh.md)和[单文件运行时分发](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md)中的平台承诺。这些记录继续约束独立验证、已安装产物来源和打包语义。[桌面发行版](../feature/2026-08-24-cross-platform-desktop-shell.zh.md)保持仅 Windows/Linux 的范围。

## 考虑过的替代方案

**仅依靠托管 runner 继续 macOS 工作。** 否决，因为维护者无法用本地设备调查原生故障，并已明确选择将时间用于 Windows 和 Linux。

**删除所有 macOS 实现。** 否决，因为移除可用的兼容代码会产生不必要的改动，也不利于使用者提交局部修复。停止维护不需要故意破坏已有行为。

**把本地 Linux 回放作为 Windows 验收前置。** 否决，因为当前开发范围优先完成 Windows，而 Linux 执行不能验证 Windows 行为。平台特有故障保留记录，供以后在对应系统调查。

## 后果

维护中的发行版不承诺 macOS 兼容性，也不发布新的 macOS Python 运行时 wheel。已有源码可能可以运行，但维护中的 CI 矩阵不验证这一点。贡献者报告需要具体复现；恢复主动维护需要明确的范围决定和原生验证负责人。

工作流回归检查拒绝 macOS runner 选择，固定三个可接受的运行时目标，并要求 GitHub/GitLab 发布内容相符。这些 CI 要求继续有效，但本地 Linux/WSL 工作不作为当前 Windows 优先 Crew 阶段的前置条件。
