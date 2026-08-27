# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 下游维护

本仓库作为基于 DeepSeek Harness 的社区下游发行版维护，并非 DeepSeek 官方发行版。下游改动继续采用 MIT 许可证；必须保留上游版权、许可证与第三方声明。

1. 创建个人 fork 后，使用 `upstream` 指向 `deepseek-ai/deepseek-harness`，使用 `origin` 指向下游仓库。
2. 至少每周获取一次官方 `master` 与标签，并检查新增提交、发行版、安全修复和破坏兼容性的变更。
3. 通过临时同步分支合入适用的上游更新。下游功能继续隔离为应用或插件，避免因冲突而 fork Harness 核心。
4. 每次发布下游版本前，确认已完成最新官方更新检查，并重新执行依赖安装、检查、完整构建与桌面运行时验证。

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/mengxingGG/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

### 桌面应用

在 Windows 和 Linux 上，源码构建还会把桌面直接运行壳写入仓库根目录：Windows 为 `DeepSeek-Harness.exe`，Linux 为 `DeepSeek-Harness.AppImage`。桌面壳把 `dsh web` 作为隐藏的回环后端启动，并在原生窗口中承载现有 Web 应用；它需要已构建的检出目录和兼容的系统 Node.js。

```sh
pnpm run build
pnpm run desktop
```

自包含安装包会带上 Electron、Node.js、pnpm、已构建 CLI 与 Web 产物，以及生产依赖闭包。请在匹配的宿主操作系统上构建：

```sh
pnpm run desktop:dist:win
pnpm run desktop:dist:linux
```

由于尚未完成原生安装与运行时验证，本下游桌面发行版不发布 macOS 桌面壳或安装包。Harness 核心与 Web 应用仍可在 macOS 上使用。

产物路径、生命周期行为、安全控制和平台限制详见[桌面应用参考](apps/desktop/README.zh.md)。

### 内置插件市场

默认 Web profile（包括桌面应用）在**设置 → 插件 → 插件市场**中提供插件市场。可以按 `balance`、`memory` 或 `tools` 等关键词搜索；留空则浏览带有 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 的热门仓库；也可以粘贴准确的 `owner/repository` 值。结果以可审阅卡片展示仓库详情，并提供明确的安装操作。

插件市场只接受根目录 `package.json` 声明有效 dsh bundle 的公开、未归档 GitHub 仓库。安装会以本机用户权限执行第三方包脚本，因此确认前必须检查仓库与源码。安装后请重启当前 profile。如需更高的 GitHub API 已认证限额，请在启动环境中设置 `GITHUB_TOKEN`。

### 用量与余额

默认 Web profile 还会挂载采用 MIT 许可证的社区插件 [`@ychris12138/dsh-usage-stats`](https://github.com/Ychris12138/dsh-usage-stats)。打开侧边栏中的**用量/余额**，即可查看供应商余额或订阅配额、今日／本月／累计 token 用量、当月每日热力图与缓存命中率。浏览器与桌面启动共用同一个面板和本地数据。

供应商凭据只保留在 Host，永远不会进入浏览器响应。插件把聚合 token 计数、会话标识、不透明修订号和折叠游标存入 `DSH_HOME/storages/usage-stats-cache.json`，不会存储提示词、回复或文件路径。支持的供应商、配置方式与 MIT 许可证见上游仓库。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
