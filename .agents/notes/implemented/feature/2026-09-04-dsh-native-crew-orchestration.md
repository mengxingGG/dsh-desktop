# Agent Note: DSH-native Crew orchestration before external providers

Status: implemented

English | [中文](2026-09-04-dsh-native-crew-orchestration.zh.md)

## Problem

The proposed one-person software studio needs one manager conversation, durable workers, module-scoped work, review and integration loops, hard completion and commit checks, restart recovery, and a live worker panel. The earlier proposal made these product guarantees depend first on several external CLI runtimes, a resident manager process, an MCP bridge back into DSH, and a separate `board.json`.

DSH already has the relevant native mechanisms: the top-level Session Agent, continuable in-process subagents, durable child descriptors, Agent Teams membership/mailbox/task records, Session event projection, and a three-column Web client. Building a second orchestration runtime would duplicate identity, queues, recovery, and logs before the product workflow is validated.

## Decision

The first phase runs entirely with DSH Agents. The current top-level Session Agent is the manager and receives normal user turns. DSH continuable subagents are development, review, and integration workers. No external CLI is required or selected in this phase.

Agent Teams remains authoritative for generic Team membership, messages, task ownership, dependencies, and advisory write-scope overlap. `@deepseek-ai/dsh-crew` references Team and child Session identities and owns software-workflow configuration, stages, host verification, review evidence, integration evidence, manager notification batches, and commit decisions.

Crew records are versioned whole-value events in the manager Session log and reconstruct through projection. Child model and tool history remains in each child Session. Repository specifications, logs, and tests remain work products and recovery evidence, not a second workflow database. There is no `board.json`.

`@deepseek-ai/dsh-tool-crew` exposes manager-only controls through the Crew profile, which the [Crew delivery decision](2026-09-06-native-crew-default-delivery.md) has since promoted out of `packages/experimental/` and into the default Web profile. Worker presets preserve role persona, model options, tool filters, and limits in the continuable descriptor. The [role policy and global-memory decision](2026-09-05-crew-role-policies-and-global-memory.md) supersedes private command snapshots and read-only integration; this note retains the durable workflow and lifecycle decisions.

Whether a session engages a Crew at all is no longer this note's single discretionary rule: the [orchestration-preset decision](2026-09-06-crew-orchestration-agent-preset.md) makes it the selected Agent preset's choice, and moves the manager persona and tool set of a mandated session into `crew-manager`.

Execution limits belong to the immutable manager configuration, not to a process-global Host instance. Every Host operation receives the recorded limits after cold resume even when deployment defaults differ. Config, command, and replay validation reject durations outside Node's timer range rather than converting a long deadline into an immediate timeout.

Lexical credential exclusions cannot identify regular-file aliases. Crew file access therefore requires a provider-observed hard-link count of one; missing metadata is a denial, not a permissive default. The local filesystem provider supplies this observation without imposing Crew policy on ordinary filesystem consumers.

Verification records the checkout after declared tests. Review completion and integration admission reject stale module inputs, specifications, HEAD, or branch. The role-policy decision permits reported integration edits and checks the resulting checkout during combined tests. Evidence identities alone cannot authorize changed files.

The [local development decision](2026-09-08-crew-local-development-without-git.md) extends verification to file inventories without Git metadata or a first commit. Git index evidence and optional local commit checks remain applicable to committed repositories.

An incomplete process-output tail cannot establish repository state even when the retained records parse successfully. Crew checkout reads reject truncated Git output and hashing failures instead of treating them as deletion. A completed Git write remains completed when only its diagnostic output is truncated; checkout reinspection, not the diagnostic tail, establishes its effect. Changed-path digests include type and permission bits because equal file contents do not imply equal executable inputs; identity and modification checks reject a file that changes during hashing. Parent-directory links and spelling normalization can substitute another file for the recorded Git path, so checkout reads reject both instead of assigning that file's content to the original path.

Native worker idleness does not imply completion of host verification. Manager-action waits therefore follow the current integration record until it settles, even when earlier modules or integration attempts already have terminal evidence.

Git status letters and working-file hashes do not identify staged content. Crew binds [logical index entries](https://git-scm.com/docs/git-ls-files) into the checkout digest and rechecks them during collection. It excludes mutable stat-cache bytes so a normal Git refresh does not invalidate evidence. Hidden-file flags are a rejection, not permission to clear user-managed index state. Commit admission compares the complete digest; authorized staging separately preserves the verified working files.

Integration tests may live outside every developer's module. Full-project integration access and shared developer directories follow the role-policy decision; the original developer Session remains responsible for module revisions.

When a worker reaches an actionable terminal edge, record and coalesce a Crew manager-notification batch and submit it through the normal Session input queue after the active manager turn. Progress changes update projections only. This preserves the model-visible-is-logged rule without creating a resident manager process or a self-MCP bridge.

The Crew Web profile registers a Session-owned tab in the shared right sidebar. Typed tab navigation retains task and worker selection alongside existing tool-detail tabs. The Crew view exposes live, read-only worker status and evidence; it never mounts the normal editable child composer. Approval remains a manager conversation tool action.

Command exit codes cannot replace the other process facts: a timed-out process can still exit zero. The Web evidence view therefore renders exit code, signal, and timeout independently, and displays each host-retained output stream as plain text with its own truncation notice. Collapsed logs and bounded scroll regions preserve access to later evidence without opening another worker interaction path.

A verdict does not identify the specification, review round, or verification it accepted. The read-only view retains these recorded references and the expected correction for each review or integration issue. Commit requests retain their target paths even when rejected before staging; the UI labels those paths as requested and separately displays the recorded commit hash or denial reason, without inferring Git effects from a path list.

The [delivery decision](2026-09-06-native-crew-default-delivery.md) promotes Crew and the Team domain into the default Web profile; generic Team tools and UI remain private experimental consumers. A delivery-profile recorded snapshot, restart matrix, browser evidence, hard policy tests, TypeScript and Python SDK projections, and a real DeepSeek-provider smoke pin the current behavior. The implemented sequence and gates are in the [core development plan](../../../../docs/developer/discussion/agent-orchestration-core-development-plan.md). External provider findings and their later order are in the [CLI research](../../../../docs/developer/discussion/agent-orchestration-cli-integration-research.md).

## Alternatives considered

- Implement Claude Code first and use its CLI process as manager and worker. Rejected for the first phase because it couples product-state design and UI behavior to one provider's authentication, transport, permissions, and version before DSH-native lifecycle is proven. It remains the first proposed external adapter after the core.
- Give every provider a bespoke Crew runtime. Rejected because the existing subagent Service Definition is the correct provider seam; Crew should consume normalized continuable children, not product-name branches.
- Make `board.json` authoritative beside Session data. Rejected because two durable authorities can disagree after partial writes or migration; Session events already own replay and released-data compatibility.
- Run a resident manager subprocess and expose Crew through MCP. Rejected because the root DSH Agent already is the manager, already has normal tools and Session input, and can be scheduled through its existing queue.
- Put software stages directly into Agent Teams tasks. Rejected because module verification, review, integration, and Git policy are product-specific; retaining a separate Crew projection keeps Agent Teams reusable.
- Allow users to navigate to and continue worker conversations. Rejected for this product because the single-manager interaction model is a user-facing invariant, while worker Sessions remain inspectable through read-only projections.

## Verification

- The keyless delivery profile runs one manager and multiple DSH-native continuable workers without external provider installation or login; the repository-local real-provider smoke runs the same native lifecycle with DeepSeek.
- Restart tests reconstruct Team, Crew, child, verification, review, integration, notification, and commit state without `board.json` or process-local authority.
- Policy tests cover tool filtering, scoped file operations, commit authorization, timer overflow, and recorded process limits after cold resume. The role-policy decision owns current Windows project-command verification and the absence of OS-isolation guarantees.
- Host checks independently verify artifacts, changed paths, and declared commands before a developer handoff advances.
- Review rejection returns to the same development child; integration requires a current passing set; commit requires quiescence, current evidence, generic user approval, and an exact approved path set.
- Logged Session input delivers actionable notification batches, while projection changes update the UI without a manager model turn.
- Browser tests keep the existing right-column tool details operational and show live read-only Crew state without an editable worker input.
- The command-evidence browser scenario renders the existing two-module recording without rewriting it; English and Chinese expectations cover keyboard disclosure, bounded output regions, and reload. Component tests separately cover truncated streams, empty output, concurrent timeout/signal/exit facts, and text that resembles HTML.
- The same browser recording pins frozen work-item references, review rounds, and the full commit hash; component tests cover rejected commits and review/integration corrections in both languages without introducing another approval action.
- TypeScript and Python SDK expectations, the keyless Session snapshot, expected workspace, package tests, browser tests, and affected bilingual documentation cover the same durable vocabulary.
- External provider adapters, Gemini CLI, provider login, and quota UI remain absent from the first-phase runtime.

## Consequences

The manager, Team, Crew projection, and child Sessions now share one event-sourced runtime, so recovery and UI state do not require a second process, MCP self-bridge, or workflow database. The cost is a separate Crew projection and a profile with deliberately narrower tools than ordinary DSH sessions.

The shared checkout can expose another module's partial work to tests. Dispatch therefore requires disjoint real paths, independent focused tests, prepared shared interfaces, overlap rejection, and quiescent integration. If these controls stop producing deterministic results, worktree isolation requires a new decision.

Tool filtering can look secure while an unrestricted shell or filesystem alias bypasses it. The implementation must validate resolved operations and real paths at execution and inspect Git facts again at settlement and commit; advisory Team write scopes are not sufficient.

Manager notification enqueue, delivery identity, and acknowledgement are durable and serialized with the Session queue. This adds whole-value notification records, but preserves delivery across each tested crash edge without a resident manager process.

Crew must keep consuming the shared Team and Subagent services. Changes that duplicate their lifecycle or persistence require a new architecture decision.
