# Agent Note: Claude Code execution for main and Crew Agents

Status: implemented

English | [中文](2026-09-09-claude-code-agent-execution.zh.md)

## Problem

Users need independent execution and model choices for the main Agent and stable Crew members, with native Claude login, account quota, live tool activity and resumable conversations. The [one-shot product providers](../../implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) deliberately return only a standalone task's outcome and cannot supply this interaction.

## Decision

Register external executors on the Agent registry under distinct model-provider routes. The Agent loop retains admission, frozen request reconstruction, scoped tools, permissions, transient assistant streams and durable Session output; the executor owns native model iteration and process cleanup inside a step. Main selection and [Crew role preferences](../../implemented/feature/2026-09-05-crew-role-policies-and-global-memory.md) consume the same catalog without replacing stable DSH member Sessions.

The Claude executor uses the pinned official Agent SDK and CLI. Its native tools, skills and project settings are disabled; an in-process MCP server exposes only the DSH Agent's assembled tool schemas and dispatches committed call identities through DSH guards. Native conversation bindings and completed-history checkpoints determine resume eligibility. Forks, interrupted native inputs and divergent histories bootstrap a new native conversation from recorded DSH history.

Native authentication owns credentials. The settings plugin displays bounded login output and forwards explicit user input. Quota refresh invokes the pinned CLI's structured usage control without inference; quota events preserve their independent observation timestamps. Missing quota stays unknown. Loading the plugin starts no model request and does not require or create Git repositories.

The composer consumes a separate `claudeUsage` projection of native per-request observations. Repeated assistant blocks do not multiply usage; model result capacity determines the denominator, and native compaction clears the old occupancy. Quota is account-wide and refreshes independently without inference. The Windows local launcher invokes the established desktop development path and retains its data directories; it depends on the workspace and built artifacts.

## Alternatives considered

An LLM adapter cannot represent a CLI that owns tool iteration. Plain terminal scraping loses call identities and approval ownership. Enabling native Claude tools would let a Crew manager bypass its DSH role restrictions. The one-shot provider remains a separate entry; its outcome-only semantics remain useful and are not superseded. The Crew role and product-provider notes remain active because this proposal extends only their execution choices.

## Verification

- Model catalog and delegation tests cover main, ordinary child and Crew route selection, including rejection before inference.
- Official SDK and native CLI fixtures cover live output, DSH tool approval, cancellation, forks and complete Host restart with persisted history.
- Account tests cover login lifecycle, quota units, unavailable data and process cleanup. Subscription probes use Sonnet 5; account and quota controls send no inference prompt.
- The canonical Claude SDK Session supplies TypeScript and Python result, notification and persistence projections. Set `DSH_PYTHON` to a Python interpreter with the Python SDK dependencies to enable its projection in `snapshots/sdk/sdk.snapshot.ts`.
- Browser and native Windows Electron tests cover account settings, image input, stable Crew continuation and shipped profile composition. Package hygiene checks the installable runtime files.

The subsequent composer metrics and local EXE supplement is handed to the user for testing. Its delivery includes compilation only; the earlier checks above do not establish runtime acceptance of this supplement.

## Consequences

The native usage control is experimental and version-pinned. Claude conversation storage remains CLI-owned and must remain available for native resume. SDK protocol changes require fixture updates and native verification; malformed observations fail visibly instead of producing fabricated quota or successful partial results.

Profile dependency traversal resolves symlinked manifests to their installation directories before discovering nested dependencies. Snapshot patches resolve their own dependencies before the snapshot library's replay dependencies, keeping test plugins out of production profiles. Linux-recorded shell snapshots remain Linux verification evidence; Windows browser and native process tests own this integration's local runtime evidence.
