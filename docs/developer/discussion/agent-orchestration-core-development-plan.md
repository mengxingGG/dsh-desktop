# DSH-native Crew orchestration development plan

English | [中文](agent-orchestration-core-development-plan.zh.md)

This is the implementation sequence for every first-phase orchestration feature except external CLI adapters. It turns the current DSH Agent into the manager, DSH continuable subagents into workers, and the existing Web application into the single user surface.

## Summary

Build the product as a Crew workflow over the existing Agent Teams and subagent capabilities. The root Session Agent is the manager; it already receives user turns and must not be wrapped in another resident CLI process or an MCP bridge back into DSH. Workers are DSH-native continuable children created by the in-process provider. Agent Teams remains the durable roster, mailbox, and dependency-aware task substrate; Crew adds software-workflow stages, hard verification, manager notifications, integration and commit gates, role presets, and the right-side UI.

The root Session log is authoritative. Do not add `board.json`, a second mailbox, or a process-local job registry as product state. Repository `docs/` and tests are durable work products and recovery evidence, but they do not replace the Session projection.

## Contents

- [Scope and fixed decisions](#scope-and-fixed-decisions)
- [Target runtime](#target-runtime)
- [Existing components to reuse](#existing-components-to-reuse)
- [Planned package ownership](#planned-package-ownership)
- [Persistent records and states](#persistent-records-and-states)
- [Enforcement model](#enforcement-model)
- [Global memory and role models](#global-memory-and-role-models)
- [Manager and worker lifecycle](#manager-and-worker-lifecycle)
- [Web client design](#web-client-design)
- [Implementation milestones](#implementation-milestones)
- [Verification strategy](#verification-strategy)
- [First-phase acceptance](#first-phase-acceptance)
- [Deferred work](#deferred-work)
- [Risks](#risks)

## Scope and fixed decisions

| Subject | First-phase decision |
|---|---|
| Manager | The current top-level DSH Session Agent; the user continues to send normal turns to it. |
| Workers | DSH continuable subagents through `subagent-spawn-in-process`; no external CLI provider. |
| Coordination | Reuse Agent Teams roster, mailbox, tasks, dependencies, and cold recovery. |
| Product workflow | Add a Crew domain that references Team members and tasks and owns software-development stages and gates. |
| State authority | Append-only events in the manager's Session log, projected on replay. |
| Repository artifacts | Manager-authored project/module specifications plus worker-authored logs and tests; useful for handoff, not the workflow database. |
| Worktree model | One checkout with disjoint module scopes in the first phase; reject overlapping active scopes. |
| User interaction | Manager conversation only; worker details are read-only except explicit approval controls. |
| Commit | A host-owned Crew tool after quiescence, verification, integration, and user acceptance; ordinary manager and worker shell access cannot write Git state. |
| External providers | Entirely deferred to the separate [CLI research](agent-orchestration-cli-integration-research.md). |
| Platforms | This phase targets native Windows development and acceptance. Linux compatibility work and local Linux/WSL verification are deferred and do not block Windows delivery. macOS is outside active development, testing, and compatibility work. Existing compatibility code remains available for platform-specific reproductions and fixes. |

## Target runtime

The Web profile composes one root Agent, the Crew service and manager tools, Agent Teams, the DSH-native continuable provider, the Crew role presets, and the Crew Web projection. A manager dispatch creates a Team task and a continuable child, binds their branded identities in one Crew work item, and returns immediately. The child runs through the standard Agent loop and records its own model/tool history in its child Session.

When a child settles, a host verifier inspects the repository and runs the declared focused test. Only the host may advance the work item to review-ready. A review worker receives read-only evidence; rejection appends a repair turn to the same development child. Once all modules pass, an integration worker checks the combined checkout. The manager may request a commit only after the user accepts the delivery and every gate still passes.

Manager wake-up is an ordinary queued Session turn, not a separate manager process. The Crew service records a durable notification batch, coalesces events within a configurable interval, and submits the batch through the normal Session input queue after the current manager turn ends. Delivery is idempotent across restart, and every byte sent to the model is reconstructable from logged events.

## Existing components to reuse

| Existing component | Reuse | Required change |
|---|---|---|
| [Agent Teams](../../../packages/subagent/agent-team/README.md) | Root-Session Team identity, durable members, mailbox, task DAG, compare-and-set updates, replay, and change waiting. | Keep it generic; add only lifecycle corrections needed by all Team consumers. Crew-specific stages stay outside this package. |
| [Agent Team tools](../../../packages/experimental/tool-agent-team/README.md) | Proven lead/member authorization patterns and compact tool results. | Crew manager preset exposes Crew vocabulary rather than the generic self-organizing task tools. |
| [Subagent service](../../../packages/subagent/subagent/README.md) | Continuable descriptors, cold resume, FIFO follow-ups, interrupt, projection, and child discovery. | Expose any missing settlement/projection hook through a general API and update every consumer. |
| [In-process spawn provider](../../../packages/subagent/subagent-spawn-in-process/README.md) | DSH-native fresh workers with inherited model, reasoning, persona, and tool filter. | Add only capabilities required to express the verified worker role preset. |
| [Session](../../../packages/session/README.md) | Durable events, projection, queueing, replay, and model-visible history. | Add Crew event members and both SDK expected outputs when the public loop projection changes. |
| [Web layout](../../../packages/client/ui-layout/README.md) | Existing resizable right details column. | Preserve the three-column shell; do not create a second application frame. |
| [Chat details panel](../../../packages/client/ui-chat/README.md) | Current owner of the right column and tool-detail selection. | Introduce a typed details-view selection extension so tool details and Crew can share the single column. |
| [Agent Team client](../../../packages/experimental/client-ui-agent-team/README.md) | Remote-call and durable Team projection patterns. | Crew receives a dedicated manager-only panel and must not navigate users into an editable worker conversation. |

Do not use the process-local jobs package as workflow authority. Process handles may be cached for live control, but all restart decisions derive from Session events and child descriptors.

## Planned package ownership

Use experimental packages until the workflow and UI have passed the recorded-session and restart gates. Package names below are the implementation targets, not a request to publish pre-stable APIs.

| Path | Ownership |
|---|---|
| `packages/subagent/crew/` | Crew Service Definition and DSH-native provider, branded records, Session events, projection, transitions, verification orchestration, recovery, and invariant checks. |
| `packages/subagent/tool-crew/` | Manager-only tool Consumers, concise model results, manager system-prompt contribution, argument schemas, and authorization. |
| `packages/client/ui-crew/` | Remote projection client, right-panel components, locale dictionaries, approval actions, status derivation, and browser tests. |
| `packages/bundle/crew-profile/` | Headless patch layer composing Crew, Agent Teams, DSH-native continuable workers, worker role presets, and manager tools. |
| `packages/bundle/crew-web-profile/` | Web patch layer composing Remote methods and Crew UI into the existing DSH Web profile. |
| `packages/subagent/agent-team/` | Generic fixes only; no module, review, integration, Git, or repository-specific fields. |
| `packages/subagent/` | General lifecycle additions only when Crew cannot observe or control a continuable child through the published service. |
| `packages/client/ui-chat/` | Typed right-details view selection and migration of existing tool details to one view implementation. |
| `snapshots/crew-native/` | Keyless recorded manager/worker workflow, child Session fixtures, workspace input, and expected workspace result. |
| `.agents/notes/` and package READMEs | Decision rationale, complete package contracts, and bilingual documentation updated with each code change. |

The Crew service is a complete capability seam: it defines the service, supplies the DSH-native provider, and has manager-tool and Web consumers. Do not create empty provider packages in anticipation of external CLIs.

## Persistent records and states

Crew reuses `TeamId`, `TeamTaskId`, and child `SessionId`. It adds branded work-item, verification, review, integration, and notification identities only where independently generated records need them. Provider session IDs do not exist in the first phase.

The first implementation should freeze whole-value, versioned Session events for configuration, work-item state, verification results, review results, integration results, manager notification enqueue, and notification delivery. Whole-value events make projection and migration explicit; committed event generations follow the repository's adjacent-migration rule.

| Record | Required facts |
|---|---|
| Crew configuration | Repository root, role presets, concurrency, coalescing interval, turn/time limits, review limit, allowed test command form, and commit policy. |
| Work item | Team task ID, module key, specification path and revision, write/read scopes, development child Session ID, stage, reason, counters, and latest accepted verification ID. |
| Verification | Exact command, cwd, exit result, required artifacts, changed paths, scope violations, start/end facts, and source child settlement. |
| Review | Reviewer child Session ID, inspected specification revision and verification ID, verdict, structured issues, round, and terminal reason. |
| Integration | Integrator child Session ID, included work items and verification IDs, combined test results, verdict, and identified owners for failures. |
| Notification | Ordered source event IDs, compact manager-facing content, enqueue state, delivered input identity, and retry-safe acknowledgement. |
| Commit decision | User-acceptance input identity, quiescence proof, current verification and integration IDs, staged paths, message, and resulting commit hash or rejection. |

Use a small workflow stage union whose transitions are owned by the Crew service: `planned`, `queued`, `running`, `verifying`, `reviewing`, `revision_required`, `integration_ready`, `accepted`, `paused`, `failed`, and `cancelled`. UI colors and labels are derived presentation and are not persisted as independent truth.

Team tasks continue to own dependency readiness and assignment. Crew stages may advance only when the referenced Team task, child lifecycle, and host evidence agree. An invariant module must compare these independently observed values and reject impossible combinations.

## Enforcement model

Role responsibilities drive cooperation. The manager uses user preferences to make decisions; tools enforce necessary project-path and approval checks. Windows delivery does not require an additional operating-system sandbox.

1. The worker preset supplies the allowed persona, model options, tool filter, cwd, readable roots, and writable roots at child creation; these values are retained in the continuable descriptor and reapplied on cold resume.
2. Developer file tools enforce assigned module paths and shared `docs/`, `test/`, and `tests/` directories. Reviewers read the complete project. Integrators read and write the complete project for integration work. Additional operations go to the manager for judgment and any required user approval.
3. Settlement verification independently reads Git status and diff paths, required artifacts, and declared tests. Team `writeScopes` remain advisory overlap metadata and are never treated as a security boundary.
4. Reviewers independently check requirements, implementation, and tests and return concrete issues to the original developer. Integrators may make cross-module edits and run combined tests. The host-owned commit tool rechecks the actual final checkout before staging and committing.

File-tool paths are normalized against the selected project and checked for path and link escapes. Authorized commands run through the existing DSH subprocess provider in the actual project, with installed dependencies, retained output files, deadlines, cancellation, and process-tree cleanup. These checks do not claim operating-system isolation or turn arbitrary scripts into safe commands.

The manager preset may create specifications, shared interfaces, and scaffolding, but its ordinary shell cannot perform Git writes. `crew_commit` is the only Git-write capability in the profile. The tool requires a current user-acceptance marker from the manager Session and never pushes.

## Global memory and role models

The fixed manager system prompt assigns responsibility for reading memory, planning work, coordinating roles, identifying dangerous operations, and informing the user. The accompanying Skill explains when to read, use, and update memory. Neither stores mutable user habits inside the system prompt.

DSH stores operating preferences and explicit scoped authorizations in its user-global settings, not in project directories or repositories. Users can view, edit, and delete each entry. Repeated past approval is a preference, not standing permission. A standing authorization requires explicit user approval of its scope; dangerous commands still need an explanation of their target, impact, and recoverability. Tool permission checks remain authoritative.

Use existing Agent context hooks to supply current memory on manager start and resume as logged input. Deleted entries must be absent from the next authoritative memory snapshot. Persist project specifications, task progress, and worker history in their existing project and Session owners, not in global operating memory.

The user can select provider, model, and reasoning effort separately for manager, developer, reviewer, and integrator. Resolve defaults when creating an Agent; existing children and revision turns retain their saved model binding. Include a global settings editor and a live, read-only child transcript in the existing Web UI. Default Web and desktop entry must retain ordinary DSH features and expose Crew without an extra launch command.

## Manager and worker lifecycle

### Manager turn

1. Clarify the goal, non-goals, constraints, and observable acceptance with the user.
2. Write or update the project specification, module specifications, shared interfaces, dependency order, focused test commands, and disjoint path scopes.
3. Call `crew_dispatch` for ready modules and end the turn; never poll or sleep while workers run.
4. On a logged Crew notification, resolve paused or failed work, report material choices to the user, and append or reassign only through Crew tools.
5. After integration passes, summarize evidence, obtain user acceptance, then call `crew_commit` if the user requested a commit.

### Development worker turn

1. Read the assigned specification, current module state, referenced interfaces, and prior development log.
2. Modify only allowed module, test, and log paths; run only the declared focused commands.
3. Produce the structured worker result through the DSH-native output schema.
4. Let the host verifier decide the authoritative transition; a claimed `done` result never completes the work item by itself.
5. On revision, continue the same child Session unless recovery proves it unusable.

### Review and integration turns

1. Review reads one frozen specification revision, changed-path evidence, developer log, and host verification; it does not edit files.
2. A rejection records structured file/line/problem/expected issues and appends them to the same development child until the configured review limit.
3. Integration starts only when every included module has a current passing review and no worker is active.
4. Integration runs combined tests and interface checks, records a structured verdict, and identifies the work item responsible for each failure.
5. The reviewer asks the original developer to repair implementation issues. The integrator owns necessary integration edits and reports every changed path. Both coordinate with the manager and leave Git commits to the approved host tool.

### Stop, failure, and restart

1. Stop interrupts the active child turn, waits for bounded settlement, and marks the result without deleting the continuable descriptor.
2. A failed worker retains its Session, logs, reason, and last verified repository state; retry and replacement are distinct manager actions.
3. On application restart, replay the root Crew and Team projections, reconcile child descriptors and current Git facts, then resume only records that were durably active.
4. A notification enqueued before shutdown is delivered at most once to the manager; a delivered notification is never reconstructed as a new model input.
5. A missing or corrupt relationship fails loud with identifiers and recovery guidance instead of creating a blank worker.

## Web client design

The existing layout remains sidebar, manager conversation, and right details column. Generalize the chat-owned details panel into a typed view-selection chain. Existing tool-call details become one selectable view, while Crew registers another; opening Crew does not unmount the manager conversation or create a new route-level application.

The Crew panel shows project state, manager state, active workers above completed workers, module, role, stage, concise reason, child Session short ID, current verification, review round, and integration state. Selecting a worker opens read-only structured details and bounded log excerpts derived from Session projections. It never mounts the standard child composer and never exposes a “continue this worker” input.

Approval controls are explicit host interactions, not chat with a worker. Every control shows the requested operation, resolved target, policy reason, lifetime of the decision, and resulting state. DSH-native first-phase policy may deny operations that have no supported narrow approval; the panel must not imply that every denial is overridable.

Remote methods return typed projections and compare-and-set mutations. Live updates use the existing client service/store patterns and a subscription or change cursor; opening the panel is not the refresh mechanism. Product text lives in typed English and Chinese dictionaries, status color is accompanied by text and icon semantics, and keyboard/focus behavior is covered by browser tests.

## Implementation milestones

### M0 — Freeze the contract and fixtures

Owned paths: the proposed Agent Note, this plan, Crew type sketches in the new package, and the initial recorded-session scenario manifest.

- Convert the architecture decision into exact service requests, event payloads, transition table, tool schemas, role presets, and error codes before UI work.
- Inventory every model-visible prompt/tool change and every TypeScript/Python SDK projection affected by new Session events.
- Define one two-module fixture repository with shared interfaces, independent tests, one review rejection, one repair, integration, and commit rejection while active.
- Add failing contract tests for invalid transitions, stale revisions, overlapping scopes, unauthorized tools, and duplicate notification delivery.

Exit gate: reviewers can trace every acceptance item to an owning package, event, test, and model-visible snapshot; no implementation decision depends on an external CLI.

### M1 — Implement the durable Crew domain

Owned paths: `packages/subagent/crew/` and generic Agent Team fixes proven necessary by its tests.

- Implement configuration validation, branded identities, versioned event declarations, append-and-flush transactions, replay projection, transition authorization, and invariants.
- Bind each Crew work item to one Team task and preserve Team dependency and owner semantics rather than copying the task board.
- Expose read-only views for manager tools and Web clients plus compare-and-set mutation requests for host actions.
- Prove concurrent mutation, replay after every event edge, incomplete final JSONL recovery, disposal, and HMR cleanup.

Exit gate: a fresh service and a replayed service return identical detached projections, and invalid Team/Crew combinations fail with stable error codes.

### M2 — Dispatch DSH-native continuable workers

Owned paths: `packages/subagent/crew/`, `packages/subagent/tool-crew/`, role preset fixtures, and only general subagent changes required by all providers.

- Implement manager-only `crew_dispatch`, `crew_append`, `crew_stop`, `crew_status`, and `crew_reassign` Consumers with compact results.
- Resolve the DSH-native provider, role persona, model, reasoning, tool filter, limits, cwd, and path policy explicitly at dispatch and snapshot them for continuation.
- Create the Team task and child in a recoverable order with compensating terminal events for partial failure.
- Route append, interrupt, settlement, and cold resume through the existing subagent service; do not hold a second process registry.

Exit gate: two disjoint workers run concurrently, append continues the same child ID, stop settles cleanly, and restart resumes from durable descriptors without duplicating a task or child.

### M3 — Enforce scopes and authoritative completion

Owned paths: Crew verification modules, filesystem and shell policy integration, test fixtures, and package documentation.

- Implement component-safe real-path checks for all declared scopes and reject overlap among active work items.
- Give developers scoped file tools and declared project tests by default. Route additional operations to the manager and existing user-approval policy; do not infer authorization from remembered preferences. Keep credential and Git-internal file checks.
- Parse the DSH-native structured result at the model-output boundary, then independently check required artifacts, Git paths, and the exact focused test command.
- Append one bounded automatic repair for a failed handoff check, then pause with durable evidence instead of looping.

Exit gate: developer file tools reject sibling-module and project-path escapes while shared documentation and tests remain accessible; approved Windows project scripts run successfully; a false `done` claim never advances to review. Tests must not claim that file-tool scopes constrain arbitrary subprocess code.

### M4 — Add review, integration, and commit gates

Owned paths: Crew review/integration/commit services, manager tools, role-specific presets, and Git operation tests.

- Dispatch a read-only review child automatically after authoritative development verification; freeze its input evidence IDs.
- Record pass or structured rejection; append rejections to the original development child and enforce the configured review-round limit.
- Implement `crew_integrate` only for a quiescent, fully reviewed dependency set; give the integrator complete project access for necessary cross-module edits, require it to report those edits, and verify the combined result through Host-run tests.
- Implement `crew_commit` with user-acceptance proof, last-moment status recheck, exact staging set, commit-message validation, and no push behavior.

Exit gate: no worker can commit, a running or stale world rejects commit, a rejected review returns to the same developer child, and only a current passing integration can be committed.

### M5 — Deliver event-driven manager turns and restart recovery

Owned paths: Crew notification journal, Session input integration, scheduler lifecycle, and restart/concurrency tests.

- Classify terminal events that require manager action and progress events that update UI only.
- Coalesce actionable events within a configurable interval, persist the ordered batch before scheduling, and submit it after the active manager turn settles.
- Record delivery identity and acknowledgement so crash points before and after submission replay without loss or duplication.
- Reconcile active records, child runtime state, Session queues, and repository facts at startup; never infer completion from an absent process alone.

Exit gate: workers may finish in either order during a manager turn, yet the manager receives one logged batch afterward; restart at each crash point preserves exactly-once model-visible delivery.

### M6 — Build the manager-only Web experience

Owned paths: `packages/client/ui-crew/`, the `ui-chat` details-view extension, Remote composition, locale dictionaries, and browser tests.

- Generalize the single details owner without changing the three-column layout, and preserve existing tool detail behavior.
- Add the live project/worker list, derived status presentation, read-only worker detail, verification/review/integration evidence, and supported approval controls.
- Keep the manager composer as the only free-form user input and prevent Crew navigation from electing the ordinary editable child conversation view.
- Cover loading, empty, stale, reconnecting, failed, narrow-window, keyboard, screen-reader, and locale states.

Exit gate: the right panel updates without manual reopen, tool details still work, no worker input box is reachable, and browser tests prove both languages and non-color status cues.

### M7 — Compose profiles and prove the shipped path

Owned paths: Crew headless/Web profile packages, preset catalogs, snapshot fixtures, both SDK expected outputs when required, and all affected bilingual READMEs.

- Compose only documented plugins through Crew profile patch layers and launch the product exclusively through `dsh --profile`.
- Add a manager preset and separate developer, reviewer, and integrator presets with explicit tool sets; reject a missing preset at profile load.
- Record the two-module keyless scenario through the shipped profile, including children, rejection/repair, manager notification, integration, UI state, and expected workspace.
- Run focused package tests followed by build, type, lint, documentation, hygiene, snapshot, and Web gates appropriate to the changed surfaces.

Exit gate: a clean Windows checkout can replay the full product path without a provider login, and every first-phase acceptance item has external world evidence rather than an Agent self-report.

## Verification strategy

Native Windows owns this phase's acceptance, including the existing Web application, Crew delivery profiles, restart recovery, both SDK projections, role-scoped file access, actual project commands, and the real DeepSeek workflow in `agent-test`. Platform-specific fixture differences need Windows-native evidence for the same user behavior; a skipped Linux case is not a Windows pass. Command verification must exercise subprocess cancellation and process-tree cleanup without claiming OS isolation. Windows desktop acceptance also covers tray hide/restore, active-work confirmation, durable stop, and complete backend-tree cleanup; external CLI adapters remain excluded. Existing Linux CI remains intact, but local Linux/WSL investigation and full Linux replay are not prerequisites for this phase ([maintenance scope](../../../.agents/notes/implemented/process/2026-09-05-windows-linux-maintenance-scope.md)).

| Layer | Required proof |
|---|---|
| Unit | Transition table, config and wire validation, branded IDs, path containment, command policy, event coalescing, error taxonomy, pure UI presenters, and locale completeness. |
| Concurrency | Compare-and-set conflicts, two worker settlements, append/stop races, notification batching, HMR disposal, and bounded teardown under shared-host scheduling. |
| Persistence | Replay after every event, incomplete-tail handling, cold child resume, notification crash points, and Git fact reconciliation. |
| Built integration | Loader/profile composition through built exports and a real DSH-native child Agent loop with only the model adapter scripted. |
| Snapshot | Keyless manager and child Sessions, exact model-visible Crew tools and notifications, SDK projections, and workspace expected tree. |
| Web | Real browser rendering, right-panel live update, details-view coexistence, read-only worker UX, accessibility, and reconnect behavior. |
| Security | Filesystem and shell escape attempts, link traversal, sibling writes, Git writes, dependency installs, stale commit, and unauthorized Team-member calls. |
| Manual smoke | Launch the shipped Crew Web profile, dispatch two modules, observe live state, restart DSH, repair one module, integrate, accept, and commit locally. |

Use the smallest focused command that covers each edit while developing. Before claiming the phase complete, select the applicable gates from the repository pre-push skill and report only commands actually run. The expected command set includes `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run hygiene`, `pnpm run test:docs`, `pnpm run doc-sync`, `pnpm run test:snapshot -t crew-native`, and the relevant Web browser gate; it does not imply running every command after every milestone.

Any change to `SessionEventMap`, loop lifecycle, or model-visible input must update the TypeScript and Python SDK expected outputs and the recorded-session scenario in the same change. Any capability, lifecycle, concurrency, subprocess, or teardown edit also requires the corresponding defensive-pattern review and targeted failure tests.

## First-phase acceptance

1. A user opens one repository and talks only to the top-level DSH manager Agent.
2. The manager can create project/module specifications, disjoint scopes, dependencies, role bindings, focused tests, and limits without an external CLI.
3. The manager dispatches at least two DSH-native workers, returns from the turn, and sees both in the durable right-side list.
4. Appending changed requirements continues the same development child Session and preserves its visible short ID.
5. Closing and reopening DSH reconstructs manager, Team, Crew, child, task, verification, review, and notification state from logs.
6. A worker cannot write outside its allowed paths, perform Git writes, install dependencies, access credentials, or obtain an equivalent unrestricted tool.
7. Worker self-report cannot complete a work item until host path, artifact, and focused-test checks pass.
8. Review rejection reaches the same development child without a user message or a new child; repeated rejection pauses at the configured limit.
9. Progress updates change the right panel without spending a manager turn; actionable terminal events are logged, coalesced, and delivered after the current turn.
10. Integration cannot start while work is active or stale and records combined test and interface evidence.
11. Commit is rejected before user acceptance, during active work, after checkout drift, or without current integration evidence; successful commit stages only approved paths and never pushes.
12. The manager conversation remains the only free-form input; worker details, logs, results, and approvals are visible without an editable child composer.
13. The shipped profile and browser path pass keyless recorded replay with an externally verified expected workspace.
14. Gemini CLI, Claude Code, Codex, Grok, Antigravity, login, and quota behavior are absent from first-phase runtime code and settings.

## Deferred work

- Local Linux/WSL environment recovery, full Linux replay, and Linux-specific compatibility fixes; resume with an explicit platform-validation scope.
- System Claude Code, Codex app-server, Grok ACP, and Antigravity `agy` adapters, including provider authentication and quota presentation.
- Automatic provider selection, cross-provider replacement, provider-specific pricing, and subscription optimization.
- Worktrees, remote repositories, multiple users, distributed workers, and cross-host scheduling.
- Direct user conversation with a worker or unrestricted worker takeover.
- Art, modeling, and non-software role templates.
- Public stabilization of experimental Crew or Agent Teams APIs.

## Risks

| Risk | Mitigation | Release signal |
|---|---|---|
| Shared checkout leaks one module's partial state into another test. | Require disjoint paths, independent focused tests, shared-interface scaffolding before dispatch, and integration only after quiescence. | Two concurrent fixture workers produce deterministic module tests and a stable combined result. |
| Tool filtering appears strict but shell or links bypass it. | Resolve typed operations and real paths in providers, then independently verify Git paths after the turn. | Escape fixtures are rejected at execution and again at settlement. |
| Crew duplicates Agent Teams and drifts. | Store generic membership, tasks, dependencies, and mailbox only in Agent Teams; Crew records references and workflow evidence. | Replay invariants reject orphan or contradictory identities. |
| Manager notifications are lost or duplicated around crashes. | Persist enqueue and delivery identities, serialize with the Session queue, and test every crash edge. | Restart matrix observes each batch exactly once in model input. |
| UI reaches directly into process state. | Serve typed Session projections over Remote and derive presentation in pure client code. | Browser reconnect reconstructs the same panel without a live worker process. |
| Commit gate can be bypassed by ordinary tools. | Remove Git-write capability from manager and worker presets and expose only host-owned `crew_commit`. | Security tests fail every alternate Git-write route. |
| Experimental packages accidentally become permanent parallel architecture. | Define promotion or deletion criteria after the shipped-path snapshot and avoid public exports before that review. | Follow-up Agent Note explicitly promotes, consolidates, or removes the experiment. |

<details>
<summary>Development note</summary>

This plan supersedes the external-CLI-first milestones, resident manager process, MCP self-bridge, and `board.json` authority in the migrated [v0.2 proposal](agent-orchestration-v0.2.md). The proposal remains useful for product vocabulary and acceptance intent. Provider work resumes only after this plan's shipped-path gate passes.

</details>
