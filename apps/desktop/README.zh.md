# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

桌面应用是现有 `dsh web` profile 的 Electron 壳。它负责原生窗口和后端进程生命周期；Web 应用、profile、设置与插件组合仍沿用 CLI（命令行界面）使用的同一套产品路径。

## 产物

| 模式 | 产物 | 运行时内容 |
|---|---|---|
| 直接运行壳 | Windows 下根目录中的 `DeepSeek-Harness.exe` 或 Linux 下的 `DeepSeek-Harness.AppImage` | 仅含 Electron。它定位已构建的检出目录，并通过兼容的系统 Node.js 启动其中的 CLI。 |
| 安装包 | `apps/desktop/dist/installers` 下的 Windows NSIS 安装程序或 Linux DEB | Electron、Node.js、pnpm、已构建的 CLI 与 Web 产物，以及完整生产依赖闭包。 |

直接运行壳属于仓库常规构建，供生成它的检出目录使用。安装包自包含，目标机器不需要检出目录、Node.js 或 pnpm。

## 命令

| 命令 | 结果 |
|---|---|
| `pnpm run build` | 构建仓库，并在 Windows 或 Linux 上把当前宿主平台的直接运行壳写入仓库根目录。 |
| `pnpm run desktop` | 执行完整构建，然后从检出目录启动桌面应用。 |
| `pnpm run desktop:dist` | 构建仓库和当前宿主平台的安装包。 |
| `pnpm run desktop:dist:win` | 在 Windows 上构建 Windows NSIS 安装程序。 |
| `pnpm run desktop:dist:linux` | 在 Linux 上构建 Linux DEB。 |

安装包采用宿主平台原生构建。若从其他操作系统调用平台专用命令，该命令会明确失败，而不会尝试不受支持的交叉构建。

## 后端生命周期

Electron 主进程把 `dsh web --no-open --host 127.0.0.1 --port 0` 作为隐藏子进程启动，等待它输出回环 URL，再把窗口导航到该源。直接运行壳执行已构建检出目录中的 `apps/cli/lib/bin.js`。安装包则用内置 Node.js 执行内置 CLI，并把内置 pnpm 入口提供给 `dsh plugin`。

Windows 关闭窗口时会询问收起到系统托盘、彻底退出或取消。收起只隐藏窗口，不中断后端；点击托盘图标或“打开”菜单会恢复同一个窗口。托盘也提供“彻底退出”。通知图标直接显示在任务栏还是放在隐藏图标区域，由 Windows 管理。

退出检查正在执行的 Agent 回合、排队回合、回合间维护、后台任务及 Crew 宿主工作。仅打开空闲会话或保存了未完成工单，不会触发二次确认。有工作时，选择“否”保持应用和任务运行；选择“是”停止工作、保存会话和 Crew 记录后退出。后端收到未经确认的关停请求时会再次检查，因此新启动的工作仍需确认。

桌面壳只为本次启动追加 Web 组合包的可选 `desktop.patch.yml`。私有的继承 IPC 通道先请求任务所有者停止并完成持久化，再由 Windows 终止后端进程树；没有 HTTP 或渲染器关停端点。准备失败或超时会保留桌面壳并显示错误；只有用户明确选择带有未保存风险提示的“强制退出”，才会越过保存确认。保存的历史可以重新打开，但退出会停止执行，不承诺自动续跑进程或排队提示词。

启动错误会用有界的 stdout 和 stderr 诊断替换加载视图。已取消的启动不会创建子进程；启动期间请求退出，会等待启动结果后再检查工作。

## 安全

渲染器启用上下文隔离和 Chromium 沙箱，并禁用 Node 集成。窗口拒绝权限请求，把普通导航限制在回环后端的源内，并在系统浏览器打开 HTTP 或 HTTPS 链接前征求确认。

## 插件兼容性

桌面壳在标准 `DSH_HOME` 下启动标准 Web profile。因此，通过 `dsh plugin` 安装的组合包在 CLI、直接运行壳和已安装桌面应用中使用同一个 profile manifest 与 loader 路径。Web profile 会挂载默认的 GitHub 插件市场与固定版本的社区用量统计插件；Electron 不定义另一套插件格式、发现 API、安装路径或统计存储。

## 验证

1. 从干净检出目录运行 `pnpm install` 和 `pnpm run build`。
2. 双击仓库根目录中的直接运行产物，确认 Web 应用在没有终端窗口的情况下打开。
3. 在 Windows 收起到托盘并重新打开同一个窗口。启动任务后选择“彻底退出”，拒绝二次确认并确认任务继续；再确认停止，检查会话已保存且没有后端进程残留。
4. 运行宿主操作系统对应的安装包命令，然后安装或打开生成的软件包。
5. 确认已安装应用打开同一个 profile、在同一个 `DSH_HOME` 下持久化设置、提供“用量/余额”面板，并能通过内置插件市场搜索、安装和加载外部组合包。

## 模型体验

无，因为桌面壳只启动现有 Web profile，不注册面向模型的提示词、工具或事件。

#### KV Cache 影响

桌面壳不增加请求 token，也不改变缓存复用；这些影响由所选 profile 挂载的插件负责。

## 已知限制与延后工作

- **签名归发布流程负责**——除非发布环境提供各平台签名凭据，否则本地构建未签名，操作系统可能显示发布者不受信任的警告。
- **不发布 macOS 桌面产物**——下游项目尚未在 macOS 上完成原生安装与运行时验证；Harness 核心与 Web 应用仍可在 macOS 上使用。
- **直接运行壳并非独立程序**——把它移出已构建检出目录后需要设置 `DSH_DESKTOP_PROJECT_ROOT`，且目标机器仍需兼容的 Node.js。
- **Linux 仅提供 DEB**——仓库目前不生成 RPM、Flatpak 或 Snap 软件包。
