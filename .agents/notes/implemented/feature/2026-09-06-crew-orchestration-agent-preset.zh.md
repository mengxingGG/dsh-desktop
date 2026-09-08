# Agent Note: Crew orchestration as a selectable Agent preset

Status: implemented

[English](2026-09-06-crew-orchestration-agent-preset.md) | 中文

## Problem

[DSH 原生 Crew](2026-09-04-dsh-native-crew-orchestration.zh.md) 发布时对所有会话只有一条启用规则：厂长策略要求模型直接处理简单请求，只在用户要求组建开发团队、或工作能从独立实现与评审中受益时才充当 Crew 厂长。于是「一次请求要不要走编排」成了模型每轮自行做出的判断，而该会话所选的普通预设仍然提供 bash、文件写入、子代理和工作流。想让每一次改动都经过规格、派工、宿主验证和独立评审的用户没有办法表达这个诉求，也没有办法拿掉那条捷径：模型随时可以判定这件事很简单，然后自己改文件。

Crew profile 里其实已经带了一个组合正确的 `crew-manager` Agent 预设——只有 persona 与仓库指令——但没有任何东西把它发布到预设列表，因此没有会话能选中它；而且厂长策略断言厂长保留普通工具，与它自相矛盾。

## Decision

Crew 编排是逐会话的选择，用 Agent 预设来表达。`crew-manager` 就是这个预设，由 `@deepseek-ai/dsh-crew-profile` 随附，并由 `@deepseek-ai/dsh-crew-web-profile` 作为第二个只读 `system` root 发布到 Web 预设列表。部署默认值仍为 `standard`：普通预设保留完整工具集和可自行判断的策略，因此在用户主动选择之前，行为与此前完全一致。

强制手段是组合，而不是提示词。`crew-manager` 命名了 persona、仓库指令、询问用户、todo、Skills、计划模式和 compaction——一层通往不了项目代码的协作面。`crew_*` 厂长工具刻意不出现在该文件里：`dsh-tool-crew` 从 Host 层把它们安装到担任 Team lead 的那个 Agent 上，所以预设只决定厂长在这些工具之外还有什么。运行它的会话可以在持久 Crew 路径范围内读写、可以派工，但不能运行 Shell、不能触及这些范围之外的文件系统、不能派生子代理、也不能启动工作流。仅靠提示词强制的方案正因如此被否决：模型可以重新斟酌的指令不构成保证。

`loadCrewProfilePresets` 用协作模块白名单而非禁用能力清单来校验组合，并在检查前把 group 行展平，否则嵌套在 `cordis:group` 内一层的能力就能通过只看顶层的扫描。黑名单会放行它写成之后新增的每一个插件；白名单则在有人同时修改组合与清单之前直接让加载失败。

启用与机制各有各的归属。`dsh-tool-crew` 拥有机制——模块范围、版本化规格、声明的验证命令、状态 revision、先评审后集成、等待语义与提交审批——它们对每个厂长都相同。它不再断言厂长有哪些工具、也不再断言何时该直接处理，而是列出启用 Crew 的三种情形，其中一种是「Agent 预设强制编排」。`crew-manager` 的 persona 陈述这条强制，`presets/roles/manager.yml` 逐字节携带同一段文本，并在加载时校验。逐会话变化的事实归属于逐会话变化的组合，而不归属于每个 profile 只配置一次的 Host 层插件。

roster 补丁位于 Web 层，因为 `agent-presets` 行属于 `dsh-web-app`。只带 Host Crew 层的 headless profile 没有 roster 可打补丁，其厂长保留可自行判断的策略。patch 会替换目标行的整个 `config`，所以 Web 层在新增 root 之外重述了 `default: standard`。

## Alternatives considered

- **把启用规则做成 `dsh-tool-crew` 的 config 字段。** 否决，因为 `tool-crew` 只是一行 Host 层配置：在那里加字段等于为整个 profile 选定一条策略，而要表达的事实是逐会话变化的。预设本来就是逐会话的组合接缝。
- **在 `dsh-tool-crew` 内部根据 Agent 所选预设 id 解析策略。** 否决，因为这会让一个 Host 层 Consumer 耦合到预设 roster 的投影，去读一个预设自己就能陈述的值，并使预设 persona 与插件策略成为同一事实的两个权威。
- **把该预设放进 `dsh-agent-presets`，与 `standard` 并列。** 它的组合没有命名任何 Crew 模块，因此在哪里都能加载——也就会在没有 Crew 层的 profile 里悄悄地什么都不做，只给用户一个厂长 persona 和零个厂长工具。把它交给提供工具的那一层随附，能让这种失败根本不可能发生，而不是无声发生。
- **新增第二个预设，保持 `crew-manager` 原样。** 作为重复被否决：两个组合只会在展示文案上不同，而 `assertManagerAgentPreset` 需要两套并行校验。`crew-manager` 本来就是那个受限的厂长组合，它缺的是入口与强制声明，不是一个兄弟。
- **保留标准模式全部工具，只加一段强制策略段。** 否决，因为捷径仍在。模型一旦判定改动微不足道就会直接改文件，那次改动也就永远没有规格、验证、评审、集成这条已记录的证据链。
- **加一个 `tools/pre-execute` 守卫拒绝非 Crew 的修改。** 否决：对一个根本不注册这些工具的组合而言它是冗余的，而且会成为第二处需要与第一处保持同步的地方。

## Verification

- `packages/bundle/crew-profile/tests/profile.spec.ts` 固定该预设组合的精确模块清单，并分别拒绝加在顶层的实现工具、藏在 group 行内部的实现工具，以及与厂长角色预设发生漂移的 persona。
- `packages/bundle/crew-web-profile/tests/profile.spec.ts` 固定打过补丁的 roster 行：注入的服务、新增 root 表达式与 `default: standard`。
- `packages/preset/agent-presets/tests/display.spec.ts` 与 `packages/client/ui-agent-preset/tests/locales.client.spec.ts` 覆盖由 bundle（而非 roster 包）随附的预设在选择器中的本地化文案。
- `apps/web/tests/crew-panel.e2e.ts` 保持随附的 Host 与 Web 层等同于其 overlay，因此 roster 补丁不会与浏览器场景实际运行的层发生漂移。
- Crew 快照期望携带模型真正收到的厂长策略。

## Consequences

选择「编排模式」的用户得到一个无法私下自己动手的厂长，那条已记录的证据链适用于该会话中的每一次改动。代价是这个预设的能力刻意窄于其他任何随附预设：需要 Shell、需要 Crew 范围之外的文件、或需要子代理的请求会被拒绝而非被满足，用户只能换预设——而会话只有在尚未产出任何内容时才能切换。

Web 层现在会重述 roster 行，因此想改默认预设或添加自有 root 的部署，必须在本层之后给 `agent-presets` 打补丁，并把本层的 root 一并重述。两者不会合并。

模块白名单让该预设的组合变成一次双文件修改。这正是刻意保留的摩擦：它阻止后来的能力在没有决策的情况下抵达厂长。

厂长策略不再描述厂长拥有哪些工具，因为那已由预设决定。未来若有别的名字的预设同样强制编排，用同样的方式陈述自己的强制即可；`dsh-tool-crew` 无需改动就能接受它。
