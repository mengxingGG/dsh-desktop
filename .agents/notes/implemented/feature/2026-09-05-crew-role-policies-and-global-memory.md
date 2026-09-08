# Agent Note: Crew role policies and user-global operating memory

Status: implemented

English | [中文](2026-09-05-crew-role-policies-and-global-memory.zh.md)

## Problem

Operating preferences belong to the user across projects. Storing them with a repository would lose them when switching projects and could publish private habits through Git. Treating repeated approvals as standing permission would also silently widen authority. Independent role models must not change the model of a developer that is already working or returning for revision.

Crew's private command snapshots and OS-specific restrictions prevented ordinary Windows project tests from using installed dependencies and child-process pipes. A read-only integrator could report an interface problem but could not perform the cross-module changes that define its responsibility.

## Decision

The [Crew preferences plugin](../../../../packages/subagent/crew/src/preferences.ts) registers one namespace with the existing [DSH settings provider](../../../../packages/settings/settings-file/README.md). The [single home resolver](../architecture/2026-07-24-single-harness-home-resolver.md), [settings ownership](../architecture/2026-07-28-user-settings-seam.md), and [browser settings mirror](../architecture/2026-08-17-settings-describe-mirror.md) remain authoritative. There is no project memory file, browser-local durable memory, or second preference database. Project specifications, task progress, and transcripts retain their existing owners.

Entries distinguish operating preferences from explicitly scoped authorization. The manager's memory tool always obtains generic approval before storing authorization. The Web editor uses a dedicated authorization confirmation. Both writers retain the observed settings revision, so stale drafts cannot overwrite newer choices. Deletion removes an entry from future authoritative snapshots but does not rewrite historical Session messages.

The manager context hook appends current memory as a logged user message on each proceeding turn's first step, including resume, and after a within-turn memory change. Its text replaces older snapshots and requires dangerous operations to explain the target, impact, and recoverability. Preferences inform judgment; they do not bypass tool policy. Four independent model defaults apply at creation. Existing worker descriptors, repair Sessions, and recorded manager request headers retain their selected model. The [default-model service](../../../../packages/core/agent-default-model/README.md) accepts an exact-Agent resolver so Web prompt variables and routing share the role default while explicit conversation selections keep priority; role changes do not write the deployment default.

Developer file tools allow assigned module paths and configured shared directories, defaulting to `docs`, `test`, and `tests`. Reviewers read the complete project and run declared tests without editing. Integrators read and write the complete project, report their additional changed paths, and run combined tests. Credential, Git-internal, traversal, and filesystem-alias checks remain enforced by the file tools.

Declared tests use the actual project and installed runtime through the existing subprocess provider. Crew owns working-directory validation, credential environment filtering, deadlines, bounded output, and managed cleanup. These are not OS isolation guarantees: a project test can access host resources with the user's process permissions. The configured program list and declared command identities remain restrictions of the test tool. Windows Node and npm project execution are covered; Linux, WSL, and macOS are not validated by these tests.

The [native Crew workflow decision](2026-09-04-dsh-native-crew-orchestration.md) remains active for durable tasks, stable child Sessions, review-repair, notifications, and commit evidence. This decision supersedes its private execution-snapshot policy and read-only integration policy. The removed LPAC launcher's creation-time Job and orderly-quiescence notes are frozen historical records, not policies of the current command runner.

## Alternatives considered

**Project-owned operating memory.** Rejected because user preferences must survive project changes without entering project version control. Project-specific work products remain separate.

**Infer permanent authorization from past approvals.** Rejected because observed behavior is not an explicit grant. Authorization retains the user's stated scope and never suppresses dangerous-operation notices.

**Apply global model changes to existing children.** Rejected because review and revision require continuity of the original developer Session and its bound options.

**Require private Windows/Linux OS sandboxes for every test.** Rejected for this Windows-first native workflow because it blocks ordinary project execution and duplicates process-launch implementations. Strong isolation can return only as an explicitly selected provider with native platform verification, not as an untested promise from path scopes.

**Keep integration read-only.** Rejected because combining modules includes necessary cross-module edits; reviewed module changes and subsequent integrator changes are both explicit inputs to final verification.

## Verification

The [Host preference tests](../../../../packages/subagent/crew/tests/preferences.spec.ts) exercise isolated DSH-home persistence, restart, scoped authorization data, revision conflicts, model resolution, and invalid input. [Native workflow tests](../../../../packages/subagent/tool-crew/tests/tool-crew.spec.ts) exercise logged memory replacement, authorization approval, stable worker models, shared developer documents, full-project review reads, and integration edits and tests. [Execution tests](../../../../packages/subagent/crew/tests/execution.spec.ts) cover real Windows project commands, dependencies, child pipes, output limits, deadlines, and cancellation.

The [Web settings scenario](../../../../apps/web/tests/crew-settings.e2e.ts) changes all four roles and memory through the real browser/Host connection, verifies the DSH-home file, reloads, edits, cancels deletion, and confirms deletion. Client tests cover stale drafts, unavailable routes, read-only settings, and generation-fenced catalog requests. These checks do not establish ordinary-profile integration, live worker transcript rendering, desktop-shell acceptance, or external CLI adapters.

## Consequences

User memory is centrally editable without creating a new storage or synchronization mechanism. Remembered authorization remains a model-visible user instruction, not an executable permission expression. Memory and role choices use the same namespace revision, so a concurrent edit may require reopening a draft even when it changed a different field.

Role file checks remain useful for accidental cross-module edits, but arbitrary test scripts are not confined to those paths. Shared documentation and test writes also require coordination between developers. Integrator reports must name their real edits; verification retains the resulting checkout rather than requiring the admission checkout to remain unchanged.
