# 原生 Crew

[English](crew.md) | 中文

原生软件 Crew 是构建在 Agent Teams 与可续接 DSH Agent 之上的私有实验工作流。Agent Teams 拥有 Lead、teammate roster、mailbox、任务依赖与建议性写范围。Crew 服务拥有软件交付阶段、精确仓库授权、宿主证据、独立审查、整合、恢复、厂长通知与获批本地提交。已实现的 [Crew Agent Note](../../.agents/notes/implemented/feature/2026-09-04-dsh-native-crew-orchestration.zh.md)记录这些所有权决策。

## 配置与角色组合

部署 `Config` 只解析一次，并以 `CrewConfigurationSnapshot` 写入厂长 Session。该快照固定仓库根、原生可续接 child provider、并发与重试限制、允许的测试可执行文件、提交策略，以及 developer、reviewer 和 integrator 的完整 `CrewRolePresetSnapshot`。`CrewAgentOptionsSnapshot` 只携带 provider、model 与 reasoning-effort 字段；其他 Agent option 留在其所属扩展中。

## 工单与 revision

`DispatchCrewWorkRequest` 创建 Agent Teams task、捕获 `CrewCheckoutSnapshot`、记录 revision-one `CrewWorkItemSnapshot`、预留开发工人 Session id，并启动原生 child。`AppendCrewWorkRequest`、`StopCrewWorkRequest` 与 `ReassignCrewWorkRequest` 都针对预期工单 revision 操作。`CreateCrewWorkItemRequest` 与 `UpdateCrewWorkItemRequest` 是 dispatch 和生命周期核对使用的底层服务记录。每次变更都采用 compare-and-set 并记录完整的新值；过期 revision 绝不会覆盖更新的证据。

活动工单必须使用互不重叠的规范化写范围。这些范围授权 Crew 文件工具，而对应 Agent Teams task 的范围仍只是协调元数据。文件操作拒绝绝对路径、路径穿越、`.git`、`.env` 变体、符号链接、替代数据流、Windows 保留名称，以及尾随点或空白别名。Windows 范围比较不区分大小写。

`CrewCheckoutSnapshot.head` 是已有提交的 Git HEAD，或表示本地文件证据的 `null`。本地证据没有分支和暂存路径，并为清单中的每个文件保留一个摘要。工单改动通过比较 `pathDigests` 得到，不会把完整本地清单当成新增工作。[项目证据规则](../../packages/subagent/crew/README.zh.md#current-implementation)定义采集与失败行为。

## 验证、审查与整合

开发工人通过一条 `RecordCrewReportRequest` 结束其 binding revision，该请求持久化为 `CrewReportSnapshot`。随后宿主检查 checkout 漂移、必需产物、声明命令与变更路径，再记录 verification。新组合的只读审查工人必须引用该通过的 verification，并记录独立结构化 review。`IntegrateCrewRequest` 冻结已审查的工单 revision 并启动只读 integrator；生成的 `CrewIntegrationSnapshot` 只有携带当前 checkout 证据和精确获批路径集合时才能通过。

`CrewVerificationSnapshot.checkout` 记录声明测试结束后的 checkout。审查完成与整合准入会把其中的规格及读写范围与当前项目证据比较。`CrewIntegrationSnapshot.inputCheckout` 在整合工人启动前冻结整个静止 checkout；组合测试后 checkout 不同则拒绝整合。

`CrewWorkerBinding` 把每个实时工人解析到一个当前工单或 integration revision。`CrewFileRead`、`CrewFileEntry` 与 `CrewTestRun` 是 scoped 工人工具使用的有界宿主结果。`CrewView` 是分离的浏览器安全读模型，`CrewProjectionState` 是 checkpoint-safe fold，而 `CrewMutationResult` 将预期的 stale-revision conflict 与其他工作流拒绝分开。

## 恢复、通知与提交

重启核对读取持久 Team membership、child descriptor 与 Crew 值。它恢复可恢复工人，把无法恢复的预留转为需要处理的终态，并且永远不会从模型文本推断成功。需要处理的终态边沿会合并成持久厂长用户消息；仅表示进度的边沿只更新 projection，不启动新的模型回合。

提交由宿主拥有，只有通用用户审批流水线准许精确的 `crew_commit` 调用后才能到达。提交前，Crew 会立即重查通过的 integration、静止 checkout、具名分支策略、获批路径 digest 与精确 staged 集合。它只创建一次本地提交，而且永不 push。

包 [README](../../packages/subagent/crew/README.zh.md)记录部署方式与限制；[开发步骤](../developer/discussion/agent-orchestration-core-development-plan.zh.md)记录第一阶段验收顺序。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

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
