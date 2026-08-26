# Agent Note: Cross-platform desktop shell and installer runtime

Status: implemented

[English](2026-08-24-cross-platform-desktop-shell.md) | 中文

## Problem

Web profile 已经是完整产品界面，但在本机使用它仍需运行终端命令并打开外部浏览器。桌面发行版需要替代这两个入口步骤，同时不能创建第二套应用、改变 profile 行为，或让 `dsh` 停留在前台控制台中。

一种产物无法同时高效满足检出目录开发和最终用户分发。检出目录已经有已构建 CLI、Web 产物和生产依赖；每次常规构建都重复复制它们，会使这条路径又慢又大。安装包则必须提供相反保证：它不能依赖源码检出目录、系统 Node.js 或单独安装的包管理器。

## Decision

`apps/desktop` 是现有 Web profile 的 Electron 宿主。其主进程拥有一个启用沙箱的浏览器窗口和一个隐藏子进程，后者运行 `dsh web --no-open --host 127.0.0.1 --port 0`。桌面壳等待 Web 组合包在启动后输出回环 URL，只在收到该就绪信号后导航，捕获有界诊断，并在应用关闭完成前终止完整子进程树。

常规 `pnpm run build` 在仓库根目录生成当前宿主平台的直接运行产物。该产物包含 Electron，但不包含 dsh 运行时。它定位已构建检出目录、选择兼容的系统 Node.js 可执行文件，并启动 `apps/cli/lib/bin.js`；双击即可同时替代 CLI 启动命令和外部浏览器，同时仍以检出目录作为可执行产品代码的来源。

`desktop:dist`、`desktop:dist:win`、`desktop:dist:mac` 与 `desktop:dist:linux` 命令在匹配的宿主操作系统上生成自包含安装包。electron-builder 运行前，`apps/desktop/runtime/package.json` 会把 CLI 的生产依赖图和所有必需工作区对等依赖部署为提升式依赖树，staging 再加入构建宿主的 Node.js 可执行文件、固定版本的 pnpm 包及对应 Node.js 许可证。可移植性检查会拒绝任何解析目标离开已部署运行时的依赖链接。打包后的桌面壳会先选择该内置运行时，再尝试发现检出目录。

CLI 插件命令接受通过 `npm_execpath` 提供的 JavaScript pnpm 入口，否则保留基于 PATH 的 `pnpm` 行为。因此，已安装桌面应用可用内置包管理器管理 profile 组合包，而无需改变 profile manifest 或插件格式。

渲染器启用上下文隔离和 Chromium 沙箱，禁用 Node 集成，拒绝权限请求，并阻止普通导航离开后端的源。HTTP 与 HTTPS 链接必须确认后才会在系统浏览器中打开。桌面应用不注册面向模型或面向插件的 API；外部功能仍通过普通 dsh 组合包提供。

## Alternatives considered

**把 Web 应用 fork 成桌面 UI。** 否决，因为这会产生两套展示实现，并使设置、profile、插件 slot 与未来 Web 行为发生偏离。用原生宿主承载组装后的 Web profile，可保持唯一产品界面。

**在 Electron 的 Node 进程内运行后端。** 否决，因为原生窗口生命周期、dsh 进程树、原生依赖与 profile 安装包会共享同一个故障和打包域。独立的纯 Node 子进程保留 CLI 运行时假设，并为关闭流程提供一个明确的进程树所有者。

**通过 pnpm 而不是已构建 CLI 启动检出目录。** 否决，因为直接运行产物仍会依赖 pnpm，并把包管理器实现入口当成产品运行时 API。直接运行壳只要求公开的已构建 CLI 和兼容的 Node.js 可执行文件。

**让每次常规构建都自包含。** 否决，因为这会在开发路径中重复检出目录已有的运行时闭包和 Node.js。区分直接运行产物与安装包，既保持常规构建便利，也保留可分发软件包。

**在 Electron 宿主中实现插件发现与安装。** 否决，因为这些操作属于普通 Web profile 组合包功能。[默认插件市场](2026-08-26-default-github-plugin-marketplace.zh.md)沿用其他插件使用的 Host Remote、Client slot、profile manifest 与安装路径，而 Electron 仍是通用生命周期宿主。

## Testing

单元测试固定回环 URL 解析、有界日志、启动失败诊断、取消、进程树关闭，以及对离开安装包 staging 的依赖链接的拒绝。运行时闭包测试要求 CLI 依赖图中的每一个必需工作区对等依赖始终可从私有部署根目录到达。

构建后的运行时用内置 Node.js 可执行文件启动内置 CLI，并通过随机回环端口提供 Web 启动 manifest。在构建 staging 目录不存在时，Windows `win-unpacked` 应用不含依赖链接，仍能启动隐藏的内置后端、返回 HTTP 200，并在主窗口关闭后释放完整的 Electron 与后端进程树。Windows 常规构建生成仓库根目录中的直接运行可执行文件，安装包路径生成 NSIS 可执行文件和 block map。macOS DMG 与 Linux DEB 的执行仍由对应宿主平台负责验证。

## Consequences

用户无需前台终端即可把本地 Web 产品作为桌面应用打开。检出目录用户通过现有构建命令获得精简运行时壳，安装包用户则在一个平台软件包中获得 Node.js、pnpm、dsh 与 Web 产物。

直接运行产物有意与生成它的检出目录耦合，并仍需兼容的系统 Node.js。安装包更大、必须在目标操作系统上构建，且除非发布环境提供签名凭据，否则保持未签名。私有运行时 manifest 是必需工作区对等依赖的维护清单；新的生产包引入另一项依赖时，闭包测试会失败。
