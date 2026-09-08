# 原生 Crew 真实 provider 冒烟测试

[English](README.md) | 中文

本目录在不安装或调用外部智能体 CLI 的情况下，使用真实 DeepSeek provider 检验已交付的 `crew-native` profile。每次运行都会在唯一的 `.run/real-*` 目录下创建一个隔离 Git 仓库，要求一名原生开发工人实现小型模块，由宿主验证产物，再启动独立原生审查工人和原生整合工人，最后检查持久 Session event 与生成文件。

运行器从仓库根目录 `.env` 读取 `API_KEY` 或 `DEEPSEEK_API_KEY`。它接受直引号或弯引号包围的值，且不会打印密钥，也不会把密钥写入运行目录。

每次运行独立拥有其 profile 依赖目录。只有 Crew bundle 入口链接到源码 checkout；运行时创建的 fallback 链接留在运行目录内，不能填入 checkout 的依赖目录。

先构建源码 checkout，再从仓库根目录运行冒烟测试：

```powershell
pnpm run build
pwsh -NoProfile -File .\agent-test\run-real-smoke.ps1
```

成功输出以 `CREW_REAL_API_VERIFIED` 结尾。`CREW_REAL_API_RUN` 打印新运行目录；可检查其中的 `transcript.txt`、`verification.json` 与 `sessions/`，分别查看模型响应、机器校验摘要和原始 Session 日志。运行会保留旧证据，超时失败也会保留转录。API 密钥和本次运行专用的环境变量只传给 DSH 子进程。

`-SingleProcessTests` 为这个小型整合测试选择 Node 的 `--test-isolation=none`，不改变 Crew 的操作系统沙箱。校验报告会声明 `executionCoverage: single-process-only`；通过不代表支持子进程，也不代表 Windows 已完整验收。

无人值守冒烟测试会在整合通过后停止。它不会伪造 `crew_commit` 所需的人类审批；无密钥交付 profile 端到端测试负责覆盖获批的本地提交。

## 执行隔离原型

`node agent-test/probe-appcontainer.mjs` 创建唯一的临时 Windows LPAC profile，把 Node 复制进私有夹具，只授予夹具范围内的文件权限，并在进程退出后移除 profile 与夹具。它使用 `registryRead` 完成 Node 的 Winsock 初始化，不授予任何网络能力。已观察到 Node 成功退出、凭证哨兵读取被拒绝、相邻文件写入被拒绝以及回环连接被拒绝。这只是可行性原型，不是 Crew 提供方，也不能证明 `crew_run_test` 已隔离。

Windows Node 24.14 上的 Crew 执行回归能到达范围读写和网络检查，但在 `execFileSync` 创建子进程管道时停滞。微软的 [AppContainer 管道命名规则](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea#remarks)要求使用本地命名空间。[libuv 开发源码](https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c)会检测 AppContainer 并选择该命名空间；对 [Node 26.8.1](https://github.com/nodejs/node/blob/v26.8.1/deps/uv/src/win/pipe.c) 的源码检查仍发现无条件管道名称。这里尚未运行验证 Node 26.8.1。该原型不授权替换系统 Node，也不授权产品自动回退到 WSL。

## Linux Web 验证

这些辅助脚本保留供后续平台验证使用。当前 [Windows 优先 Crew 计划](../docs/developer/discussion/agent-orchestration-core-development-plan.zh.md)延后 Linux/WSL 调查与回放，不将其作为 Windows 验收前置条件。它们不是未解决 Windows 执行故障的产品回退方案。

WSL 辅助脚本在唯一的 `/home/admin1/.cache/dsh-crew-web/run-*` 目录下创建源码副本，不携带 `.env`、已有依赖或旧构建产物。它们使用经过校验和验证的 Node 24.14.0 和仓库固定的 pnpm 11.7.0，在副本中恢复 Git 记录的符号链接，并就地安装测试依赖。`prepare-linux-browser-libs.sh` 把缺少的 Chromium 库解包到该目录，不执行系统安装。`run-linux-web.sh` 把每次运行的日志与 JSON 报告保存在唯一结果目录中；`--built` 使用已有构建运行。这些脚本只是宿主专用的测试准备，不是产品启动入口。
