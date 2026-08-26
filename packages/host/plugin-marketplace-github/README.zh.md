# @deepseek-ai/dsh-host-plugin-marketplace-github

[English](README.md) | 中文

面向 Web 插件市场的 GitHub 发现与 profile 安装提供方。`PluginMarketplaceGateway` 注册带有 `search` 和 `add` 方法的 `pluginMarketplace` Typert Remote。[`api-remotes`](../../api/remotes/README.zh.md) 挂载生成的 Client 贡献；本包不声明同进程 Client API。

搜索接受关键词、准确的 `owner/repository` 标识或 GitHub 仓库 URL。关键词留空时，请求带有已配置 topic 的热门仓库。每个结果都是公开且未归档的仓库，并且其根目录 `package.json` 声明有效的 npm 包名和 `dsh.bundle.patch`；未通过任一检查的仓库不会进入结果。结果包含供浏览器卡片使用的仓库标识、包名、描述、源码 URL、默认分支、star 数、fork 数、许可证和更新时间。

安装会重新获取所选仓库及其 manifest，再运行普通的隐藏 `dsh plugin --profile <profile> add github:<owner/repository>` 路径。同一时间只运行一次安装。服务 dispose（资源释放）会取消正在运行的进程树；只有 profile 修改成功退出后，Remote 才会报告成功。安装成功后必须重启 profile，新 bundle 才会激活。

## 配置

| 配置键 | 默认值 | 用途 |
|---|---|---|
| `topic` | `dsh-plugin` | 关键词搜索与留空搜索要求的 GitHub topic。 |
| `searchMaxResults` | `8` | 每次搜索最多返回的已校验卡片数。 |
| `requestTimeoutMs` | `15000` | 每次 GitHub 请求的超时时间。 |
| `installTimeoutMs` | `300000` | 插件安装进程的超时时间。 |
| `profile` | `web` | 安装操作修改的 profile。 |
| `tokenEnv` | `GITHUB_TOKEN` | 存放可选 GitHub token 的启动环境变量。 |

浏览器永远不能传入 token。安装器会在启动第三方包脚本前，删除名称中包含 `KEY`、`SECRET`、`TOKEN` 或 `PASSWORD` 的继承环境变量，同时保留 `dsh plugin` 所需的 profile 与内置包管理器环境。

## 模型体验

无，因为该 Host Remote 不注册提示词、工具、消息或提供方输入。

#### KV Cache 影响

无；搜索和安装从不组装模型输入。

## 已知限制与暂缓事项

- **受 GitHub 可用性与限额约束** —— 未认证搜索使用 GitHub 较低的 API 限额；GitHub 短暂故障会阻止发现和 manifest 复核。
- **安装会执行第三方代码** —— manifest 校验只能证明 dsh bundle 结构，不能证明信任度、安全性、维护质量或兼容性；浏览器调用 `add` 前必须取得用户明确确认。
- **仅提供安装** —— Remote 不会在免重启情况下激活 bundle，也不提供更新、移除、签名验证、内容精选或依赖冲突解决。
