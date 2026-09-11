# Agent Note: Manager-led Crew delivery and bounded delegation

Status: implemented

English | [中文](2026-09-11-manager-led-crew-delivery.zh.md)

## Problem

Per-module developer, reviewer, and integrator chains repeat context and spend extra request capacity on small repairs. A manager without coding tools cannot finish a nearly complete task. Retrying integration against stale verification can encourage destructive attempts to restore old file digests.

## Decision

The manager retains shell, file editing, and search tools. It delegates substantial independent responsibilities, reuses developer Sessions, and handles small repairs and integration directly. Default dispatch uses manager review; independent review and dedicated integration remain explicit choices. Automatic repair defaults to zero, giving the manager the next recovery decision. The [Crew service](../../../../packages/subagent/crew/README.md) owns parameters and evidence semantics.

Manager integration stops at active workers, records fresh verification and manager review against current files, and retains artifacts on failure. The lead Session identifies the actor; manager review is never represented as an independent child review. Existing Session generations remain untouched. Released work items without `reviewMode` retain independent-review semantics; integrations without `execution` retain worker execution semantics.

Worker capability allowlists cover inherited, exact-scope, and later registrations, and apply to discovery and execution. Workers cannot use ordinary subagent or workflow tools to acquire a broader tool set. This does not turn authorized host commands into an operating-system sandbox.

Default worker capacity is two active work items. A separate host request pool includes managers and groups provider routes sharing one account. Native streams release their permits when they end. External execution releases permits during DSH tools and reacquires them before returning tool results, allowing manager waits without occupying child capacity.

This supersedes the mandatory-delegation restriction in [the selectable preset decision](2026-09-06-crew-orchestration-agent-preset.md), while retaining its roster publication, persona consistency, and validated composition. It also supersedes automatic per-module review in [native Crew delivery](2026-09-06-native-crew-default-delivery.md); durable evidence, native Sessions, and optional independent review remain useful.

## Alternatives considered

- Prompt-only limits leave extra scoped tools callable and cannot repair stale evidence handling.
- Always creating an independent reviewer and integrator repeats context for minor work; explicit independent review remains available for work that warrants it.
- Holding a provider permit throughout a CLI tool wait can deadlock a manager and its workers on the same account.
- Removing verification or deleting files to restore an old digest loses delivery evidence or completed work; current-file verification preserves both.

## Consequences

The manager can finish small failures without spawning replacement Agents. Routine review loses independence unless explicitly requested, and completion evidence states who reviewed the files. Provider grouping is configured by the deployment because different routes can share credentials. Host concurrency caps cannot account for other applications using the same account.

Required regression cases include scoped-tool escape denial, existing-developer continuation, manager recovery with changed files and corrected commands, missing artifacts, cancellation and restart during verification, and shared-account request admission with tool waits. Tests are not executed for this delivery at the user's request.
