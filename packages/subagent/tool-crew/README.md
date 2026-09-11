---
description: "Scoped native Crew tools for managers, developers, reviewers, and integrators."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-crew

English | [中文](README.zh.md)

`crew_dispatch.review_mode` defaults to `manager`. `crew_integrate` defaults to manager execution, requires `review_summary`, and accepts additional `changed_paths` and corrected combined `test_commands`. Worker capability limits cover every registration layer, including later tools; ordinary subagent and workflow tools cannot bypass the role.

## Summary

`dsh-tool-crew` exposes the native Crew service to models without an external CLI adapter. Team Leads receive repository-file operations, workflow controls, and global memory access. Crew workers receive only the role-specific filesystem, declared-test, and structured-report tools that the durable assignment permits. `crew_commit` always enters the generic approval pipeline, derives its approval identity from the tool call, commits only integration-approved paths, and never pushes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this Consumer through [`@deepseek-ai/dsh-crew-profile`](../../bundle/crew-profile/README.md). The profile supplies four role declarations while preserving ordinary manager tools and presets. Worker assignments install their exact role tools. Direct compositions mount Agent Teams and Crew first and enable `requireRolePresets` to reject incomplete role configuration at activation.

### Tool sets

- **Managers** — `crew_read_file`, `crew_list_files`, `crew_write_file`, `crew_edit_file`, `crew_dispatch`, `crew_append`, `crew_stop`, `crew_status`, `crew_wait`, `crew_reassign`, `crew_integrate`, and `crew_commit`. `crew_wait` defaults to the next Team lifecycle edge; `until: "manager-action"` skips intermediate worker changes until intervention, integration, or a terminal integration result is available. Both modes tell the manager to re-read status, so one-shot hosts can wait without polling.
- **Developers** — `crew_read_file`, `crew_list_files`, `crew_write_file`, `crew_edit_file`, `crew_run_test`, and `crew_report`.
- **Reviewers** — `crew_read_file`, `crew_list_files`, `crew_run_test`, and `crew_report`; file access covers the complete project but cannot write.
- **Integrators** — the developer tool set with complete project read and write access for integration changes and declared combined tests.

The manager's `crew_memory` operations require the Crew preferences plugin. Reads return the current DSH-global entries and their revision. Saves and deletions use that exact revision; saving standing authorization always requests generic user approval. A preference never grants permission by itself.

The manager receives a logged `crew-memory` user message on the first proceeding step of each turn, including a resumed turn, and when memory changes during a turn. Each snapshot explicitly replaces earlier memory snapshots; absent entries revoke their remembered applicability without deleting historical messages. Preferences inform judgment, authorizations retain their explicit scope, and dangerous operations still require an explanation of target, impact, and recoverability.

Registrations live on each exact Agent scope and are removed with that Agent or plugin generation. The Crew service remains authoritative for role binding, revision checks, path containment, verification, recovery, and commit eligibility.

Manager-action waits remain pending while the current integration runs host verification, even after its native worker becomes idle. Reviewed modules and historical integration results do not complete that wait; a paused or failed work item still offers immediate intervention.

`crew_run_test` runs a manager-declared command in the actual project, with installed dependencies and persistent generated files. Working-directory checks, environment filtering, deadlines, output limits, and process-tree cleanup remain Host-owned. It is not an OS sandbox; the [Crew service limitations](../crew/README.md#known-limitations-and-deferred-work) apply to every declared command.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) validates role declarations, contributes manager and worker policy sections, and registers tools only after resolving the caller's live Team membership and Crew binding. Manager operations call `ctx.crew`; worker file and test calls remain restricted by the durable assignment. Results use declared schemas and compact JSON. `crew_commit` is the only mutating Git entry and reaches the host-only commit method only after the generic approval layer admits the same tool call.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Crew service](../crew/README.md) — durable workflow state, host gates, recovery, and commit eligibility.
- [Crew profile](../../bundle/crew-profile/README.md) — required roles and additive manager composition.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-crew) — exact schemas and result fields presented to each role.

-----

<a id="model-experience"></a>
## Model Experience

### Crew policy and tool schemas

#### What the model sees

The manager policy favors broad delegation, member reuse, direct small repairs, and optional independent review. Workers receive only role-permitted tools; local development requires no Git commit or remote access.

#### Token effect

Each Crew Agent request carries one stable role policy and its role-specific schemas. Tool calls append compact JSON receipts, status views, bounded command output, or structured evidence; repository file content enters context only when the model explicitly reads it.

#### KV Cache effect

The policy and schema prefix remains stable while the plugin generation, role preset, and role binding remain unchanged. Assignment prompts, file reads, tool results, and manager notifications append after that prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Pre-stable API** — model schemas and their consumers evolve together.
- **No external CLI adapters** — all workers are native DSH continuable Agents; provider login and quota surfaces are outside this package.
- **Shared checkout** — tools enforce durable path scopes, but Host verification remains necessary because other local processes can modify the checkout.
- **Approval is required for commit** — `crew_commit` creates one local commit from passing integration paths and never pushes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep `CREW_ROLE_TOOL_NAMES`, profile role YAML, registered tools, and generated catalog rows synchronized. Activation rejects drift before any scoped tools are installed.

</details>

**Runtime invariant:** no companion is published. The Crew service owns the durable authorization and evidence relationships used by these Consumers.
