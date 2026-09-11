# Native Crew

English | [中文](crew.zh.md)

The native software Crew is a private experimental workflow over Agent Teams and continuable DSH Agents. Agent Teams owns the Lead, teammate roster, mailbox, task dependencies, and advisory write scopes. The Crew service owns software-delivery stages, exact repository authorization, host evidence, independent review, integration, recovery, manager notification, and approved local commit. The implemented [Crew Agent Note](../../.agents/notes/implemented/feature/2026-09-04-dsh-native-crew-orchestration.md) records these ownership decisions.

## Configuration and role composition

Deployment `Config` is resolved once into `CrewConfigurationSnapshot` in the manager Session. The snapshot fixes the repository root, native continuable-child provider, concurrency and retry limits, allowed test executables, commit policy, and a complete `CrewRolePresetSnapshot` for developer, reviewer, and integrator. `CrewAgentOptionsSnapshot` carries only provider, model, and reasoning-effort fields; every other Agent option stays with its owning extension.

## Work items and revisions

`DispatchCrewWorkRequest` creates the Agent Teams task, captures a `CrewCheckoutSnapshot`, records a revision-one `CrewWorkItemSnapshot`, reserves the developer Session id, and starts the native child. `AppendCrewWorkRequest`, `StopCrewWorkRequest`, and `ReassignCrewWorkRequest` operate on an expected work-item revision. `CreateCrewWorkItemRequest` and `UpdateCrewWorkItemRequest` are the lower-level service records used by dispatch and lifecycle reconciliation. Every mutation is compare-and-set and records a complete next value; a stale revision never overwrites newer evidence.

Active work items must have non-overlapping normalized write scopes. Those scopes authorize Crew file tools, while the matching Agent Teams task scopes remain coordination metadata. File operations reject absolute paths, traversal, `.git`, `.env` variants, symbolic links, alternate streams, reserved Windows names, and trailing-dot or whitespace aliases. Windows scope comparisons are case-insensitive.

`CrewCheckoutSnapshot.head` is a committed Git HEAD or `null` for local-file evidence. Local evidence has no branch or staged paths and retains one digest per inventoried file. Work-item changes come from comparing `pathDigests`, not from treating the whole local inventory as new work. The [project evidence rules](../../packages/subagent/crew/README.md#current-implementation) define collection and failure behavior.

## Verification, review, and integration

A developer ends its binding revision with one `RecordCrewReportRequest`, persisted as `CrewReportSnapshot`. The host then checks checkout drift, required artifacts, declared commands, and changed paths before recording verification. A newly composed read-only reviewer must cite that passing verification and records a separate structured review. `IntegrateCrewRequest` freezes reviewed work-item revisions and starts a read-only integrator; the resulting `CrewIntegrationSnapshot` can pass only with current checkout evidence and an exact approved path set.

`CrewVerificationSnapshot.checkout` records the checkout after declared tests. Review completion and integration admission compare its specification and read/write scopes with current project evidence. `CrewIntegrationSnapshot.inputCheckout` freezes the entire quiescent checkout before the integrator starts; a different checkout after combined tests rejects integration.

`CrewWorkerBinding` resolves each live worker to one current work-item or integration revision. `CrewFileRead`, `CrewFileEntry`, and `CrewTestRun` are bounded host results used by scoped worker tools. `CrewView` is the detached browser-safe read model, `CrewProjectionState` is the checkpoint-safe fold, and `CrewMutationResult` keeps expected stale-revision conflicts separate from other workflow rejections.

## Recovery, notification, and commit

Restart reconciliation reads durable Team membership, child descriptors, and Crew values. It resumes recoverable workers, converts unrecoverable reservations into actionable terminal state, and never infers success from model prose. Actionable terminal edges are batched into durable manager user messages; progress-only edges update the projection without starting another model turn.

Commit is host-owned and reachable only after the generic user-approval pipeline admits the exact `crew_commit` call. Immediately before committing, Crew rechecks the passing integration, quiet checkout, named branch policy, approved path digests, and exact staged set. It creates one local commit and never pushes.

The package [README](../../packages/subagent/crew/README.md) documents deployment and limitations; the [development plan](../developer/discussion/agent-orchestration-core-development-plan.md) records the first-phase acceptance order.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcrew--crewservice"></a>

### `ctx.crew` — `CrewService`

Native Crew service and DSH provider for the first-phase software workflow.

```ts cordis-catalog
/**
 * Persist immutable Crew configuration on first use and return it.
 * @param caller - Exact live Team Lead requesting Crew service.
 * @returns Existing or newly persisted Crew configuration.
 */
async ensureConfigured(caller: Agent): Promise<CrewConfigurationSnapshot>

/**
 * Create a Team task, freeze its checkout baseline, and start one native developer.
 * @param caller - Exact live Team Lead managing the workflow.
 * @param request - Module scope, specification, evidence, and cancellation request.
 * @returns Durable work item after native developer provisioning.
 */
async dispatch(caller: Agent, request: DispatchCrewWorkRequest): Promise<CrewWorkItemSnapshot>

/**
 * Continue the current native developer without allocating a replacement child.
 * @param caller - Exact live Team Lead managing the workflow.
 * @param request - Current revision, follow-up prompt, and cancellation signal.
 * @returns Updated durable work item.
 */
async append(caller: Agent, request: AppendCrewWorkRequest): Promise<CrewWorkItemSnapshot>

/**
 * Interrupt and release the active worker, preserving its durable child descriptor.
 * @param caller - Exact live Team Lead managing the workflow.
 * @param request - Current revision and durable pause reason.
 * @returns Paused durable work item.
 */
async stop(caller: Agent, request: StopCrewWorkRequest): Promise<CrewWorkItemSnapshot>

/**
 * Replace a parked developer with a newly composed native child.
 * @param caller - Exact live Team Lead managing the workflow.
 * @param request - Current revision, replacement reason, and cancellation signal.
 * @returns Durable work item after replacement provisioning.
 */
async reassign(caller: Agent, request: ReassignCrewWorkRequest): Promise<CrewWorkItemSnapshot>

/**
 * Verify manager-reviewed files directly, or delegate independently reviewed modules.
 * @param caller - Exact live Team Lead managing the workflow.
 * @param request - Execution owner, review assessment, selected work, and combined commands.
 * @returns Terminal manager integration or running delegated integration.
 */
async integrate(caller: Agent, request: IntegrateCrewRequest): Promise<CrewIntegrationSnapshot>

/**
 * Resolve the exact durable Crew role currently owned by one worker Agent.
 * @param caller - Exact live Team teammate requesting a worker operation.
 * @returns Current work-item or integration binding.
 */
workerBinding(caller: Agent): CrewWorkerBinding

/**
 * Read one file through the caller's durable Crew scope.
 * @param caller - Exact live Crew worker Agent.
 * @param path - Candidate repository-relative file path.
 * @param signal - Caller cancellation signal.
 * @returns Normalized path and bounded UTF-8 content.
 */
async readWorkerFile(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileRead>

/**
 * Read one repository file as the Team Lead without exposing Git metadata or credentials.
 * @param caller - Exact live Team Lead.
 * @param path - Candidate repository-relative file path.
 * @param signal - Caller cancellation signal.
 * @returns Normalized path and bounded UTF-8 content.
 */
async readManagerFile(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileRead>

/**
 * List one repository directory as the Team Lead.
 * @param caller - Exact live Team Lead.
 * @param path - Candidate repository-relative directory path.
 * @param signal - Caller cancellation signal.
 * @returns Bounded direct directory entries.
 */
async listManagerFiles(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileEntry[]>

/**
 * Create or replace one repository file as the Team Lead through Crew path policy.
 * @param caller - Exact live Team Lead.
 * @param path - Candidate repository-relative file path.
 * @param content - Complete replacement UTF-8 content.
 * @param signal - Caller cancellation signal.
 * @returns Normalized path and whether the file was created or updated.
 */
async writeManagerFile(caller: Agent, path: string, content: string, signal: AbortSignal): Promise<{ path: string; operation: 'create' | 'update' }>

/**
 * Apply one literal repository edit as the Team Lead through Crew path policy.
 * @param caller - Exact live Team Lead.
 * @param path - Candidate repository-relative file path.
 * @param oldString - Literal text that must exist.
 * @param newString - Literal replacement text.
 * @param replaceAll - Whether every occurrence may be replaced.
 * @param signal - Caller cancellation signal.
 * @returns Normalized path and confirmed replacement status.
 */
async editManagerFile( caller: Agent, path: string, oldString: string, newString: string, replaceAll: boolean, signal: AbortSignal, ): Promise<{ path: string; replaced: true }>

/**
 * List one directory through the caller's durable Crew scope.
 * @param caller - Exact live Crew worker Agent.
 * @param path - Candidate repository-relative directory path.
 * @param signal - Caller cancellation signal.
 * @returns Bounded direct directory entries.
 */
async listWorkerFiles(caller: Agent, path: string, signal: AbortSignal): Promise<CrewFileEntry[]>

/**
 * Write a developer-scoped file or an integrator's project file; reviewers cannot write.
 * @param caller - Exact live Crew worker Agent.
 * @param path - Candidate repository-relative file path.
 * @param content - Complete replacement UTF-8 content.
 * @param signal - Caller cancellation signal.
 * @returns Normalized path and whether the file was created or updated.
 */
async writeWorkerFile(caller: Agent, path: string, content: string, signal: AbortSignal): Promise<{ path: string; operation: 'create' | 'update' }>

/**
 * Apply one literal edit within the developer's assignment or the integrator's project.
 * @param caller - Exact live Crew worker Agent.
 * @param path - Candidate repository-relative file path.
 * @param oldString - Literal text that must exist.
 * @param newString - Literal replacement text.
 * @param replaceAll - Whether every occurrence may be replaced.
 * @param signal - Caller cancellation signal.
 * @returns Normalized path and confirmed replacement status.
 */
async editWorkerFile( caller: Agent, path: string, oldString: string, newString: string, replaceAll: boolean, signal: AbortSignal, ): Promise<{ path: string; replaced: true }>

/**
 * Run a declared module or integration test for the exact current worker.
 * @param caller - Exact live worker Agent.
 * @param commandId - Predeclared command identity from the work item or integration.
 * @param signal - Caller cancellation signal.
 * @returns Host-authoritative bounded command result.
 */
async runWorkerTest(caller: Agent, commandId: string, signal: AbortSignal): Promise<CrewTestRun>

/**
 * Persist one structured report attributed to the exact current worker binding.
 * @param caller - Exact live Crew worker Agent.
 * @param request - Structured verdict, evidence summary, paths, and issues.
 * @returns Immutable durable worker report.
 */
async recordReport(caller: Agent, request: RecordCrewReportRequest): Promise<CrewReportSnapshot>

/**
 * Bind one existing Team task to an immutable Crew module specification.
 * @param caller - Exact live Team Lead.
 * @param request - Existing task identity, module scope, evidence, and checkout baseline.
 * @returns Newly persisted planned work item.
 */
async createWorkItem(caller: Agent, request: CreateCrewWorkItemRequest): Promise<CrewWorkItemSnapshot>

/**
 * Apply one authorized compare-and-set workflow transition.
 * @param caller - Exact live Team Lead.
 * @param request - Expected revision and complete transition updates.
 * @returns Updated durable work item.
 */
async updateWorkItem(caller: Agent, request: UpdateCrewWorkItemRequest): Promise<CrewWorkItemSnapshot>

/**
 * Return a detached browser-safe projection for the manager Session.
 * @param caller - Exact live Team Lead.
 * @returns Detached current Crew view.
 */
view(caller: Agent): CrewView

/**
 * Generated Remote read for the manager-only Crew panel.
 * @param agent - Authenticated Agent supplied by the Remote gateway.
 * @returns Detached current Crew view.
 */
@Remote('view') remoteView(agent: Agent): CrewView

/**
 * Preserve expected Crew rejections as Remote business results.
 * @param operation - In-flight Crew mutation.
 * @returns Success value or stable conflict/rejection result.
 */
async mutationResult<T>(operation: Promise<T>): Promise<CrewMutationResult<T>>

/**
 * Expose current Crew state to package-owned runtime modules.
 * @param root - Exact live Team Lead owning the Crew Session.
 * @returns Authoritative current Crew projection state.
 */
stateFor(root: Agent): CrewProjectionState
```

Types: [Agent](core.md)

Source: [`packages/subagent/crew/src/index.ts`](../../packages/subagent/crew/src/index.ts)

<a id="ctxcrewpreferences--crewpreferences"></a>

### `ctx.crewPreferences` — `CrewPreferences`

Role defaults and editable memory shared by all projects in one DSH installation.

```ts cordis-catalog
/**
 * Read current DSH-global roles and memory.
 * @returns Detached current preferences with their optimistic-write revision.
 */
snapshot(): CrewPreferencesSnapshot

/**
 * Resolve explicit role defaults for a new Agent; existing Agent bindings are unchanged.
 * @param role - Responsibility of the new Agent.
 * @param base - Profile-owned model defaults.
 * @returns Detached options resolved at Agent creation.
 */
resolveRole(role: CrewRole, base: CrewAgentOptionsSnapshot): CrewAgentOptionsSnapshot

/**
 * Persist one memory entry after the calling Consumer has obtained any required user approval.
 * @param id - Stable entry identifier.
 * @param entry - Remembered preference or explicitly authorized scope.
 * @param expectedRevision - Revision shown to the caller; stale edits reject without writing.
 */
async saveMemory(id: CrewMemoryId, entry: CrewMemoryEntry, expectedRevision: number): Promise<void>

/**
 * Remove one memory entry without changing role defaults or other entries.
 * @param id - Stable entry identifier.
 * @param expectedRevision - Revision shown to the caller; stale edits reject without writing.
 */
async deleteMemory(id: CrewMemoryId, expectedRevision: number): Promise<void>
```

Source: [`packages/subagent/crew/src/preferences.ts`](../../packages/subagent/crew/src/preferences.ts)

<a id="ctxcrewprofilepresets--crewprofilepresets"></a>

### `ctx.crewProfilePresets` — `CrewProfilePresets`

Validated immutable presets supplied to the Crew domain and tool Consumer.

Source: [`packages/bundle/crew-profile/src/index.ts`](../../packages/bundle/crew-profile/src/index.ts)
<!-- END GENERATED cordis-surface -->
