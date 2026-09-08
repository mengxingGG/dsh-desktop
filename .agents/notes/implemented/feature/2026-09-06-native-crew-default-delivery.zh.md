# Agent Note: Native Crew ships in the default Web profile

Status: implemented

[English](2026-09-06-native-crew-default-delivery.md) | 中文

## Problem

[DSH 原生 Crew](2026-09-04-dsh-native-crew-orchestration.zh.md) 当初是作为一组私有实验包构建的，并留下了明确条件：「Promotion requires explicit review after the shipped profile evidence; the follow-up decision must consolidate, stabilize, or remove them rather than silently preserving duplication.」此后交付 profile 快照、重启矩阵、浏览器证据、策略测试、SDK 投影与真实 provider 冒烟都已积累，条件已满足，这个问题就摆在台面上。

把 Crew 放进发布 profile 不是改配置那么简单。[`packages/experimental/AGENTS.md`](../../../../packages/experimental/AGENTS.md) 禁止发布包或应用在 `dependencies` 中命名实验包，dsh 发布家族也排除该目录。因此，安装 Crew bundle 的 `web` profile 模板不可能让这些 bundle 继续留在 `packages/experimental/` 下。

Team 领域、它面向模型的九个工具、它的 Web 花名册，以及两个独立 profile 层此前同为实验状态，而 Crew 只消费其中的领域部分。整体晋升会顺带发布一套没有任何产品路径在用的、直接面向模型的第二套团队界面。

## Decision

原生 Crew 成为默认 Web 体验的一部分。`PROFILE_TEMPLATES.web` 在 base 与 Web 应用 bundle 之后安装 `@deepseek-ai/dsh-crew-profile` 与 `@deepseek-ai/dsh-crew-web-profile`，因此 `dsh web` 无需任何插件步骤即可获得 Crew 工具、Crew 详情栏和[编排 Agent 预设](2026-09-06-crew-orchestration-agent-preset.zh.md)。

按[晋升规则](../../../../packages/experimental/AGENTS.md)晋升六个包：各自迁出实验分组、进入对应的产品角色分组，npm 名去掉 `experimental-`，清除 `private`，并声明 `publishConfig.access: public`。除浏览器插件改用所在分组的 `ui-` 前缀外，其余目录名保持不变。

| 职责 | 位置 | npm 名 |
|---|---|---|
| Team 领域 | [`packages/subagent/agent-team`](../../../../packages/subagent/agent-team/README.zh.md) | `@deepseek-ai/dsh-agent-team` |
| Crew 领域 | [`packages/subagent/crew`](../../../../packages/subagent/crew/README.zh.md) | `@deepseek-ai/dsh-crew` |
| Crew 工具 | [`packages/subagent/tool-crew`](../../../../packages/subagent/tool-crew/README.zh.md) | `@deepseek-ai/dsh-tool-crew` |
| Crew Web UI | [`packages/client/ui-crew`](../../../../packages/client/ui-crew/README.zh.md) | `@deepseek-ai/dsh-client-ui-crew` |
| Crew Host profile | [`packages/bundle/crew-profile`](../../../../packages/bundle/crew-profile/README.zh.md) | `@deepseek-ai/dsh-crew-profile` |
| Crew Web profile | [`packages/bundle/crew-web-profile`](../../../../packages/bundle/crew-web-profile/README.zh.md) | `@deepseek-ai/dsh-crew-web-profile` |

Team 领域一并晋升，是因为 Crew 依赖它提供成员关系、mailbox、任务归属与建议性写入范围；已发布的 Crew 不能建立在实验依赖之上。

直接面向模型的 Team 界面保持实验且私有：`dsh-experimental-tool-agent-team`、`dsh-experimental-client-ui-agent-team`、`dsh-experimental-agent-team-profile`、`dsh-experimental-agent-team-web-profile`。Crew 通过 `ctx.agentTeams` 而非这些工具触达 Team，因此发布路径上没有任何东西需要它们。它们仍可通过各自的 profile 层使用，并保留在 `apps/cli` 的 `devDependencies` 中，用于 Team e2e 覆盖。

晋升改变的是路径与名字，不是契约。Crew 能力仍是预稳定的：模型 schema、持久记录与 profile 声明仍与其 Consumer 一同演进，各晋升包的 README 也继续这样声明。改变的是公开 npm 名，不是兼容性承诺。

## Alternatives considered

- **让所有 Crew 包保持实验状态，要求用户 `dsh plugin add`。** 否决，因为[编排记录](2026-09-04-dsh-native-crew-orchestration.zh.md)要求的交付证据已经具备；而且默认 Web profile 去安装实验 bundle，恰恰违反了实验子树存在的意义——发布排除规则。真正的选项是「发不发」，而不是「从 `packages/experimental/` 发」。
- **把整个 Agent Teams 家族随 Crew 一起晋升。** 否决，因为那会发布第二套团队协作界面——九个模型工具加一个花名册 UI——而没有任何已发布产品路径在消费它，等于在任何产品验证之前就锁定它们的契约。只晋升 Crew 真正依赖的那个领域。
- **干脆删掉实验版 Team 工具与 UI。** 作为过早决定被否决：它们是 Crew 软件工作流之外唯一在行使通用 Team 成员关系与消息机制的界面，其 e2e 覆盖正是让该领域对非 Crew Consumer 保持诚实的东西。
- **迁移目录后保留 `experimental-` npm 前缀。** 否决，因为该前缀正是工作区约束门禁与发布家族读取的发布信号；已发布的包不该顶着「被排除」的名字，而「是否已发布」有两个事实来源必然漂移。

## Consequences

`dsh web` 现在默认交付 Crew，于是 Crew Host 与 Web 层进入发布产物，其契约由每一位默认 Web 用户行使，而不再只由选择性 profile 行使。对外声明仍是预稳定，这正是用来限制公开 npm 名本会隐含的那种承诺。

每一处 import、Cordis 配置行、生成目录、tsconfig 条目和文档引用都必须与目录原子地一起迁移。[编排预设改动](2026-09-06-crew-orchestration-agent-preset.zh.md)发现文档那一半没做完——生成目录、子系统页、分组地图与开发计划中约 120 条陈旧的 `packages/experimental/…` 链接——并将其补齐。教训是：晋升要到 `verify-package-paths` 与 `verify-md-links` 通过才算完成，而不是代码能编译就算完成。

Agent Teams 分组现在横跨两种生命周期：已发布的领域在 `packages/subagent/agent-team`，四个私有 Consumer 在 `packages/experimental/`。这个拆分是刻意的，但也意味着实验 Consumer 必须依赖一个已发布的包——实验规则本就允许——并且日后关于它们的决策不可能再是整家族一次性迁移。
