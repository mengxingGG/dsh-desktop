# Agent Note: Grok and Antigravity CLI execution routes

Status: implemented

English | [中文](2026-09-11-grok-antigravity-cli-adapters.zh.md)

## Problem

Main Agents and stable Crew members need native Grok and Antigravity accounts without bypassing DSH tool restrictions. Their CLI protocols do not provide Claude's SDK-owned in-process tool callbacks, and the installed Antigravity version reports complete result text.

## Decision

The adapters extend the [external Agent execution registry](2026-09-09-claude-code-agent-execution.md). A structured response envelope carries text and requested DSH calls; DSH validates and commits calls before dispatch. Grok native tools are disabled. Antigravity uses a generated global agent allowing only native `finish`, without MCP or customization inheritance; native discovery must find that definition before input is sent. Private native workspaces hold request files without touching the user's project. The [Codex adapter](2026-09-11-codex-cli-adapter.md) uses the same response envelope with its native app-server protocol; Claude retains its independent callback implementation.

Native checkpoints belong to one DSH Session and input signature. Continuation sends only new messages; interrupted requests, model/tool changes and divergent histories bootstrap from the recorded DSH input. This preserves Crew member identity without trusting a native session id as sufficient continuation evidence.

Native CLIs retain credential ownership. Settings offer explicit native login terminals and model discovery. Grok directory diagnostics cannot override the user's known working login; status remains unknown until a successful execution. Antigravity quota queries are manual, validate native table rows and never add unrestricted-permission flags. Neither provider's invocation cost is treated as remaining subscription quota.

## Alternatives considered

Direct subscription API calls would replace native credential ownership. Unrestricted native tools would bypass Crew role restrictions. A complete MCP/ACP bridge requires separate proven tool-disabling and callback capabilities for each runtime; structured output provides one explicit DSH dispatch path while retaining native authentication. Streaming partial JSON would expose an invalid response to users, so this first route buffers the validated envelope.

## Verification and limitations

The implementation is compiled, while automated tests, real model requests, native cancellation under load and recorded-session replay are deferred at the user's request. Native model discovery returned fourteen Antigravity model ids. Grok returned a two-model local directory with an auxiliary authentication diagnostic; the user confirmed their command-line account works. No login reset or credential mutation was performed.

Empty-input inspection of AGY 1.1.27 found that workspace-only definitions were not discovered, while global definitions were listed and selected (`agentScript=true`). Its `init.tools` lists the global catalog even for a selected custom agent, so it is not an effective permission report. The adapter checks discovery and selected identity, declares a `finish`-only allowlist, and aborts observed native tool calls outside that list. Real tool enforcement remains part of user acceptance. This route initially supports text, DSH tools and complete-response output; media and generation overrides are rejected. The existing Claude execution and manager-led Crew notes retain their independent responsibilities.

## Sources

- [Antigravity headless protocol](https://antigravity.google/docs/cli/headless/)
- [Antigravity custom agent specifications](https://antigravity.google/docs/subagents)
- [Grok CLI agent protocol](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)
