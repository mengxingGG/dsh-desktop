# Agent Note: 默认 GitHub 插件市场

Status: implemented

[English](2026-08-26-default-github-plugin-marketplace.md) | 中文

## Problem

公开 dsh bundle 可以通过 CLI（命令行界面）安装，但仓库发现、manifest 识别与安装命令都要求用户预先了解。桌面窗口不以终端作为主要界面；如果在 Electron 中实现插件市场，插件行为就会依赖展示宿主，而不是 Web profile。

搜索结果还会跨越信任边界。公开 GitHub 仓库可能无关、格式错误、已废弃或具有恶意；热门程度和 topic 标签不能证明它是 dsh bundle，也不能证明其安装脚本安全。

## Decision

标准 Web 组合包默认把插件市场作为两个普通 Cordis 插件挂载。`@deepseek-ai/dsh-host-plugin-marketplace-github` 负责 GitHub 访问、manifest 校验、profile 修改、超时、取消与 `pluginMarketplace` Typert Remote。`@deepseek-ai/dsh-client-ui-settings-plugin-marketplace` 贡献本地化设置标签页、搜索提示、仓库卡片、详情、源码链接、明确确认与安装状态。[`@deepseek-ai/dsh-api-remotes`](../../../../packages/api/remotes/README.zh.md) 是唯一的 Host 到 Client 组合点。

关键词搜索与留空搜索要求可配置的 `dsh-plugin` topic。准确的 `owner/repository` 值与仓库 URL 会绕过 topic 发现，但仍保留全部仓库和 manifest 检查。结果必须来自公开、未归档的仓库，且根目录 `package.json` 必须包含有效 npm 包名和 `dsh.bundle.patch`；Host 会在浏览器收到结果前排除所有其他仓库。

安装是独立的已审阅操作，不是搜索或展开卡片的副作用。Client 会警告第三方包脚本以本机账户权限运行，并要求用户对所选仓库与包名明确确认。Host 会复核仓库、串行执行安装、以隐藏进程调用普通 profile 插件命令、限制诊断输出、清除继承的含密环境变量，并在服务卸载时取消进程树。已安装 bundle 会在 profile 重启后激活。

GitHub token 仍是由 `tokenEnv` 配置选择的 Host 启动环境事项，永远不会跨越 Remote。默认配置可在 GitHub 未认证限额内免 token 工作。由于两侧都是普通 Web 组合包配置项，overlay 可以停用或替换任一侧；浏览器与桌面启动共享同一个插件市场，不需要 Electron API。

## Alternatives considered

**把插件市场放入 Electron。** 否决，因为纯浏览器启动会失去该功能，插件安装还会多出第二套桌面专用实现。把 Electron 限定在窗口和后端生命周期，可保留[桌面壳决策](2026-08-24-cross-platform-desktop-shell.zh.md)。

**只在外部仓库提供插件市场。** 对本发行版否决，因为用户必须先掌握 CLI 安装流程，才能发现用于简化该流程的 UI。这些包仍是普通插件，因此面向上游或精简部署可以省略它们。

**显示任意 GitHub 搜索结果。** 否决，因为只匹配 topic 会包含 dsh loader 无法使用的仓库。Host 侧仓库与 manifest 校验可阻止无效条目进入可信的 Client 方法结果。

**从结果卡片立即安装。** 否决，因为执行第三方安装脚本前必须展示源码元数据并取得明确的信任决定。详情与安装保持为独立控件。

## Testing

Host 测试覆盖关键词发现、准确仓库查找、manifest 过滤、token 选择、安装参数、含密环境清除、输出限制、超时、取消与 Remote 注册。Client 测试覆盖本地化卡片、搜索提示、详情展开、确认、成功与失败状态、延迟 slot 声明、重新声明、本地化变化与 teardown。组装后的 Web profile 和桌面运行时使用相同 Remote 名称与 Cordis 配置项。

## Consequences

Web 与桌面用户无需复制 CLI 命令，即可发现兼容的公开仓库并开始安装。搜索卡片提供足以支持审慎检查的源码元数据，同时标准 profile 与包管理器仍是唯一安装机制。

发现功能受 GitHub 可用性与限额约束。结构校验与确认不能使第三方代码变得安全、精选、已签名、持续维护或兼容。激活需要重启；更新、移除、私有仓库访问、权限、签名、已安装状态校准与依赖冲突报告仍属于独立工作。
