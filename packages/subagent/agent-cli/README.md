---
description: "Native Grok, Antigravity and Codex execution routes, account controls, and DSH tool ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-cli

English | [中文](README.zh.md)

## Summary

The Web profile registers `grok-cli`, `antigravity-cli` and `codex-cli` as execution routes for main Agents and stable Crew members. Native CLIs own authentication and conversation storage; DSH owns every tool call, permission, result, and Session.

## Table of Contents

- [Usage](#usage)
- [Execution and continuation](#execution-and-continuation)
- [Accounts and limits](#accounts-and-limits)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="usage"></a>
## Usage

Install the native CLI and authenticate through its normal flow. Select its provider and a discovered model in the conversation picker or Crew role settings. `grokExecutable`, `antigravityExecutable` and `codexExecutable` accept absolute overrides; discovery checks native Windows install locations and PATH executables without running command shims. Linux uses PATH. No installer, Git initialization, account reset, or CLI update runs automatically.

<a id="execution-and-continuation"></a>
## Execution and continuation

Each native invocation returns a structured text/tool-request envelope. Tool names and JSON object arguments are validated before DSH commits assistant calls and executes them through the admitted callback. Grok native tools are disabled and denied. Antigravity uses a DSH-namespaced definition under `antigravityAgentRoot` (default `~/.gemini/config/agents`), allowing only native `finish`, with MCP and customization inheritance disabled. Native agent discovery must find this definition before a prompt is sent; observed native tool calls other than `finish` abort the invocation. Private workspaces under `runtimeRoot` hold protocol files rather than the user's project.

A durable checkpoint records the native conversation id, DSH owner, input signature and synchronized message prefix. Native resume uses Grok `--resume` or Antigravity `--conversation`; a fresh Grok conversation alone uses `--session-id`. Interrupted input, changed system/tools/model, forks, and divergent history bootstrap from DSH history. Input and output byte limits reject oversized data without truncating model history. Native process ranges drain on completion, cancellation, timeout and plugin unload.

Codex uses native app-server stdio, durable `thread/start` and eligible `thread/resume`, with `turn/start.outputSchema` constraining the same response envelope. Model discovery supplies available reasoning levels. Native commands, hooks, plugins, skills and inherited MCP entries are disabled through per-process and per-thread configuration; native approvals are denied, and a read-only, network-disabled sandbox is required in the thread response. Unexpected native items abort the turn. This route does not grant native project access or use Git worktrees. Read-only sandboxing alone does not restrict all native file reads; effective tool isolation under model load remains part of runtime acceptance.

<a id="accounts-and-limits"></a>
## Accounts and limits

`cliAgents` exposes native model refresh, bounded user-controlled login terminals and cached status. Grok's model listing can return local models while reporting an unverified account; only successful inference confirms that account in DSH. Credential files are never read by the adapter. Login cannot start during an active provider execution.

Grok remaining quota stays unknown. Antigravity quota refresh invokes native `/usage` only after a user action, uses the restricted DSH native agent, and rejects output that is not a quota table. Versions requiring native file access cannot supply quota through this route; the query can consume a CLI request, and no permission bypass is added. Returned remaining percentages become used percentages, with dynamic pool/window rows. Invocation counters are distinct from quota; Antigravity cumulative usage is differenced against its completed native checkpoint. Missing context capacity stays unknown.

Codex account and model discovery use `account/read` and paginated `model/list`. Manual quota refresh uses `account/rateLimits/read` without a model turn or usage-reset operation, preserving all reported pools and nullable windows/reset times. Token observations difference cumulative thread counters against the completed checkpoint; the latest request's total tokens and reported model context window describe context occupancy. Missing native counters and subscription cost remain unknown. Reasoning effort changes invalidate continuation eligibility.

The configuration owns `runtimeRoot`, `antigravityAgentRoot`, explicit `env`, account/request/login deadlines, input/output byte bounds and disposal grace. Crew's existing provider-group request admission also covers these routes. The package has no separate invariant installer: checkpoint eligibility and tool-name checks are enforced by the executor that makes each decision.

<a id="model-experience"></a>
## Model Experience

### Structured native execution

#### What the model sees

The native model receives the recorded DSH system instructions, scoped tool catalog and serialized conversation, plus the response-envelope instructions owned by `src/protocol.ts`. Native tools cannot substitute for DSH permissions. The package adds no model-facing tool schema of its own.

#### Token effect

A fresh conversation includes the full DSH history and JSON response protocol. A synchronized continuation sends only new messages; tool definitions and system text are resent only when the signature changes and a new native conversation is required.

#### KV Cache effect

Stable native conversation ids preserve the CLI's opportunity to reuse its cache. Model, system or tool changes intentionally bootstrap a new conversation; the adapter makes no cache-hit guarantee.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

This route buffers structured output until a complete validated result and supports text and DSH tools. Codex accepts native reasoning effort; media, temperature, stop sequences and output-token overrides are rejected. It does not expose native tool progress. Runtime acceptance, cancellation under native load, and recorded Session replay remain unverified in this delivery at the user's request.

## Dev Note

[Subagent subsystem](../../../docs/subsystems/subagent.md) owns the shared execution vocabulary. See the [Grok/Antigravity decision](../../../.agents/notes/implemented/feature/2026-09-11-grok-antigravity-cli-adapters.md) and [Codex decision](../../../.agents/notes/implemented/feature/2026-09-11-codex-cli-adapter.md) for native protocol tradeoffs and verification limits.
