---
description: "Native Crew workflow over Agent Teams tasks, continuable DSH workers, durable evidence, and host verification."
kind: "package-reference"
---

# @deepseek-ai/dsh-crew

English | [中文](README.zh.md)

Dispatch defaults to `reviewMode: "manager"`: delegate broad modules, reuse developers through `append()`, and let the manager review, repair, and integrate. Independent review is opt-in. Automatic repair defaults to zero; two active work items are allowed by default, excluding paused and integration-ready items.

Manager `integrate()` requires `reviewSummary` and accepts additional `changedPaths`. Stop affected workers before repairs. The supplied combined `testCommands` verifies current files and can correct earlier command declarations. Evidence names the manager Session, without creating a reviewer or claiming independent review. Failed verification preserves files for retry. `execution: "worker"` retains dedicated integration of independently reviewed modules.

Host `maxConcurrentRequests` defaults to two per provider group, including the manager. `providerRequestLimits` overrides group limits; `providerRequestGroups` joins routes sharing one account. External execution releases admission while tools run, so waiting managers do not block child requests.

## Summary

Coordinate native developers, independent reviewers, and integrators through durable software work items. Crew binds those work items to Agent Teams tasks, records revisions and evidence in the manager Session, and reconstructs them through `ctx.sessionProjections`. Agent Teams owns membership, messages, task ownership, and dependencies; child Sessions own worker transcripts.

## Table of Contents

- [Use this package](#use-this-package)
- [Durable state](#durable-state)
- [Global memory and role models](#global-memory-and-role-models)
- [Current implementation](#current-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load it after Agent Teams, Session persistence and projections, and the subagent service. A manager Session is its implicit Crew root. `ensureConfigured()` records the resolved repository root and native role presets once; `createWorkItem()` binds an existing Team task after exact scope and command validation; `updateWorkItem()` applies a compare-and-set transition and checks the matching Team task state.

Product composition belongs to the Crew profile package and the default Web profile; applications launch through `dsh`.

Local development requires only a project directory. Dispatch, verification, review, and integration work without a Git repository or an initial commit. Crew never initializes a repository or contacts a remote for these operations. A local commit is optional and requires a separately approved request against an existing repository with a committed HEAD.

Notification batching, worker turns, process grace, Git deadlines, and declared test deadlines accept positive whole milliseconds up to `MAX_TIMER_DELAY_MS` from `dsh-timeout`. Deployment validation and Session replay reject larger values rather than letting Node clamp them to one millisecond. Host operations use the manager Session's recorded execution limits, including after a restart with different deployment defaults.

<a id="durable-state"></a>
## Durable state

The manager Session owns `crew/configuration`, `crew/work-item`, `crew/report`, `crew/verification`, `crew/review`, `crew/integration`, `crew/notification`, and `crew/commit` events. Current-version payloads are validated completely on replay. Work items and integrations use contiguous revisions; the closed stage table rejects invalid edges; notifications retain one stable user-message id across delivery retries.

No `board.json` or process-local workflow database exists. Repository files are work products and verification inputs only.

The [desktop exit preparation](../../../.agents/notes/implemented/feature/2026-09-05-windows-tray-durable-exit.md) drains Crew host work and stops notification scheduling before Agent Sessions close. Crew refuses new management work after preparation begins; existing durable task and worker records remain available for restart reconciliation.

<a id="global-memory-and-role-models"></a>
## Global memory and role models

The `/preferences` plugin registers `crew-preferences` with the existing [DSH settings provider](../../settings/settings-file/README.md). Operating preferences, explicitly scoped authorizations, and four role model defaults belong to the user's DSH home, independently of the current repository. Project specifications, task progress, and transcripts retain their project and Session owners.

`CrewPreferences` bounds memory entry count and text size, validates paired provider/model selections, and fences edits by settings revision. A new worker resolves its role defaults once and persists those options in its continuable descriptor; repair and cold resume retain that binding. The manager tool Consumer supplies current memory as logged context and applies the manager default to the first request. The [Web settings section](../../client/ui-crew/README.md#global-settings) exposes direct user edits and deletion. Historical Session messages are retained when an entry is deleted.

<a id="current-implementation"></a>
## Current implementation

Crew file tools reject symbolic links and regular files whose hard-link count is not exactly one. A backend that cannot report this count cannot authorize Crew file access. These path checks do not isolate the checkout from concurrent changes by unrelated host processes.

The service dispatches DSH-native continuable developers, resumes the same child for bounded repair, starts independent reviewers and editing integrators, and reconciles active records after restart. Every developer handoff is followed by host-owned artifact, path, and exact-command verification. Actionable terminal changes become durable manager messages after the current manager turn; progress changes only update the live projection. Local commit rechecks the quiet checkout, passing integration, approval identity, and exact staged paths and never pushes.

Delegated review and integration require evidence matching current inputs. Manager recovery records fresh evidence instead of reverting files to an old digest.

Checkout digests bind changed-path content, file type, and permission bits. A link contributes its link text, not its target file. Checkout reads reject linked parent directories before hashing descendants and reject Git path spellings that require whitespace or separator normalization. Only filesystem-observed absence becomes deletion evidence; failed Git hashing, truncated Git output, or a file changing during collection rejects the observation. Git writes retain their independent exit and diagnostic-truncation results; subsequent checkout reads establish the durable outcome.

The checkout digest also includes logical Git index entries. Collection rejects index changes but tolerates ordinary file-stat cache refreshes. Integration and commit compare the complete digest; the authorized staging step compares working-file evidence separately. Index flags that hide tracked changes cause rejection without modifying the flags. Clear `assume-unchanged` and `skip-worktree` outside Crew before retrying.

Without a root `.git` or committed HEAD, Crew uses local file digests. `execution.ignoredDirectories` defaults to `node_modules`, `.npm-cache`, `.pnpm-store`, `dist`, `build`, `coverage`, and `.next`; `.git` and `.env` remain protected. This local-inventory rule never excludes tracked Git files.

Declared commands run in the actual project through the existing subprocess provider, using installed dependencies and retaining generated files. The host validates the real working directory, filters credential environment variables, bounds output and deadlines, and awaits managed process completion. Windows npm/pnpm Node shims resolve to their installed JavaScript entry without shell interpolation. This runner does not enforce OS filesystem or network isolation.

Developer file access covers assigned module paths and configured shared directories, defaulting to `docs`, `test`, and `tests`. Reviewers read the complete project and run declared tests without editing. Integrators read and write the complete project, report every additional edit, and run combined tests. All file operations retain credential, Git-internal, path-traversal, and alias checks.

The [role policy and global-memory decision](../../../.agents/notes/implemented/feature/2026-09-05-crew-role-policies-and-global-memory.md) owns these policies. The ordinary [subprocess provider](../../subprocess/subprocess-local/README.md) owns platform process-tree cleanup.

<a id="model-experience"></a>
## Model Experience

### Worker assignments and manager notifications

#### What the model sees

Each native worker receives a host-authored assignment that names its `moduleKey`, specification path and revision, allowed read and write scopes, required artifacts, declared test commands, and the structured-report requirement. The manager receives durable `crew-notification` user messages for actionable worker, review, and integration outcomes. The dedicated Crew tool Consumer owns the tool schemas and stable role policy.

#### Token effect

One assignment enters each new worker's history; repair instructions enter the same durable developer history. Batched manager notifications add only terminal summaries and stable evidence identities, while progress-only Crew events stay outside model context.

#### KV Cache effect

Role prompts and tool schemas are owned by the profile and tool Consumer. This package's assignments and notifications append after those reusable prefixes; their variable specification, scope, revision, and evidence fields do not invalidate the earlier prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- APIs are pre-stable; current event generation is version 1 and released Session data follows adjacent migration.
- External CLI providers, provider login, quota displays, worktrees, distributed workers, and direct user-to-worker chat are outside the first phase.
- The shared checkout requires non-overlapping assigned module write scopes; shared documentation and tests still require coordination. Arbitrary test scripts are not confined by the file-tool path checks.
- Windows project execution is tested with the installed Node and npm runtime. Linux, WSL, and macOS execution are not validated by that evidence.
- Test tools accept only manager-declared commands and configured program names. Additional operations require separate manager coordination; the native test runner is not a general permission or OS sandbox engine.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Follow the [native Crew development plan](../../../docs/developer/discussion/agent-orchestration-core-development-plan.md) and the implemented [Crew Agent Note](../../../.agents/notes/implemented/feature/2026-09-04-dsh-native-crew-orchestration.md). Keep generic roster, mailbox, task, and child lifecycle behavior in their current owners.

</details>

**Runtime invariant:** [`./invariant`](src/invariant.ts) compares independently observed Crew work items with Team tasks, members, and current child bindings. Projection-internal revision and transition checks remain in the projection.
