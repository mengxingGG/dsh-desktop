# @deepseek-ai/dsh-client-ui-settings-plugin-marketplace

[English](README.md) | 中文

Web 设置中的 GitHub **插件市场**标签页。浏览器插件注册一个 id 为 `marketplace` 的本地化 `settings.plugins.tab` 贡献；“插件”分区拥有导航入口与标签栏。注册使用 `ctx.slots.inject()`，因此该贡献能跟随标签 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

标签页会说明实用的搜索方式，并提供 `balance`、`memory` 和 `tools` 快捷项。搜索通过 [`api-remotes`](../../api/remotes/README.zh.md) 调用 `ctx.remote.pluginMarketplace.search()`，再以响应式卡片展示已校验的仓库。每张卡片展示源码元数据，可展开查看包名、分支、许可证与更新时间详情，并能打开 GitHub 仓库。空白、加载中、无匹配、限额与失败状态都只属于已挂载组件。

安装是独立的卡片操作。浏览器在调用 `ctx.remote.pluginMarketplace.add()` 前，会明确列出包名与仓库，并要求用户确认第三方包脚本将以本机账户权限运行。成功状态会提示用户重启当前 dsh profile；UI 不会把尚未激活的 bundle 显示为已启用。

## 模型体验

无，因为本包只提供浏览器设置控件，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅支持 GitHub 仓库** —— 标签页不提供 registry、本地目录或私有仓库来源，也不精选或背书搜索结果。
- **重启后完成激活** —— 安装会修改磁盘上的 profile，但标签页不会重启 Host 或热挂载新 bundle。
- **不管理生命周期** —— 已安装状态、更新、移除、签名、权限与兼容性报告不属于本标签页。
