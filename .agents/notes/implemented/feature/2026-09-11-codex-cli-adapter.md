# Agent Note: Codex CLI execution with DSH-owned tools

Status: implemented

English | [中文](2026-09-11-codex-cli-adapter.zh.md)

## Problem

Main Agents and persistent Crew members need the user's native Codex subscription, selectable models and quota visibility. Delegating the entire project to a native coding agent would bypass DSH tool admission and split execution records between unrelated orchestration systems.

## Decision

The [shared CLI executor](../../../../packages/subagent/agent-cli/README.md) registers `codex-cli` beside the [Grok and Antigravity routes](2026-09-11-grok-antigravity-cli-adapters.md). Native app-server owns authentication, model discovery and durable threads. Each turn returns the existing structured DSH response envelope; DSH validates, records and executes requested tools. Continuation requires the same DSH owner, model, reasoning level, instructions, tools and synchronized message prefix. Interrupted or divergent input bootstraps from DSH history.

The adapter requires native read-only sandboxing with network disabled, denies approval requests, disables native execution features, inherited MCP entries and hooks, and uses a private protocol directory. It rejects native items other than messages, reasoning and context compaction. These restrictions do not make the read-only sandbox a file-read allowlist; effective isolation and cancellation under model load require runtime acceptance. No native Git initialization, worktree, installer or account reset is part of the route.

Account and paginated model queries require no inference. Manual native quota reads preserve separate account pools, unavailable windows and reset times; no reset credit is consumed. Native cumulative token deltas describe the invocation, while the latest request counter and reported context capacity describe context occupancy. Unknown values remain unknown, including per-call subscription cost.

## Alternatives considered

**Native project tools:** native execution would avoid the JSON envelope but bypass DSH Crew tool scopes and its logged result path. The adapter retains DSH execution ownership.

**Dynamic native callbacks:** app-server supports dynamic tools, but a second callback lifecycle would duplicate the existing validated tool-admission route. Structured responses share the same dispatch and continuation semantics as the other CLI adapters, at the cost of buffered final text.

**Direct subscription API calls:** native app-server retains native credential handling and model availability. Reading credential files or imitating subscription requests would introduce a separate authentication implementation.

## Consequences

Codex is available through the same main-Agent and Crew model selection, including native reasoning levels. Text and DSH tool results are supported; images, temperature, stop sequences and output-token overrides are rejected. Native tool progress is not a DSH execution stream. The separate one-shot `subagent-codex` provider retains its own execution policy.

Native CLI 0.153.4 supplied the generated protocol schemas. A read-only host inspection confirmed the existing ChatGPT account, six available models with reasoning levels, multiple quota pools and read-only configuration. The sandboxed inspection could not access the account; the same host inspection succeeded. No model turn, login reset or credential-file inspection was performed. Automated fixtures cover accounting admission but remain unrun; model execution, native tool isolation, cancellation and recorded Session replay remain user acceptance work.

The Claude execution and Grok/Antigravity notes remain active because their callback ownership and native permission decisions still apply independently; this note adds the Codex-specific protocol and accounting decisions.

## Sources

- [OpenAI app-server protocol](https://developers.openai.com/codex/app-server/)
- [OpenAI configuration reference](https://developers.openai.com/codex/config-reference/)
