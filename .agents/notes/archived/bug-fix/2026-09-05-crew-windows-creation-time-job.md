# Agent Note: Crew Windows processes join their Job during creation

Status: implemented
Archived: 2026-09-06

English | [中文](2026-09-05-crew-windows-creation-time-job.zh.md)

## Problem

Creating a suspended process prevents target code from running before Job assignment, but a host terminated between creation and assignment cannot clean up that unassigned process. Crew must establish its process-tree owner without relying on a later host call.

## Decision

The [Crew Windows launcher](../../../../packages/experimental/crew/src/execution-windows.ts) passes its private kill-on-close Job through `PROC_THREAD_ATTRIBUTE_JOB_LIST` in the same `CreateProcessW` call that establishes LPAC security and inherited stdio. The Job handle is not inherited. Attribute failure rejects launch; there is no post-creation assignment fallback. Suspension remains until the launcher owns the returned handles.

Microsoft documents [creation-time Job lists](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) for Windows 10 and newer. This change does not widen file grants, add network capabilities, or replace the installed Node runtime.

The [shared Win32 primitives decision](../architecture/2026-08-19-shared-win32-process-primitives.md) remains active for restricted-token consumers and their distinct launch API. The [Windows ACL sandbox decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) retains its write-only policy; Crew's private LPAC inputs do not replace that sandbox.

## Alternatives considered

**Assign the suspended process after creation.** This prevents target execution before assignment but leaves a host-exit interval with no Job owner.

**Retry without the Job-list attribute.** A fallback would restore that interval exactly when the requested creation policy fails.

## Verification

The [native regression](../../../../packages/experimental/crew/tests/execution-windows.spec.ts) preserves the real process-creation call and queries the exact private Job with `IsProcessInJob` before control returns to the launcher. A successful command has membership at that point; injected attribute rejection creates no process. Private snapshot cleanup runs after either outcome. The positive membership assertion fails against post-creation assignment.

This Windows-only creation property has no Session payload or Web presentation change. Native API observations supply its regression evidence. The [execution suite](../../../../packages/experimental/crew/tests/execution.spec.ts) separately checks bounded output and deadlines; its piped-child case remains failing on Node 24.14 and is not replaced by this regression.

## Consequences

Every successfully created Crew process has its Job owner before host-side continuation. Windows closes the non-inherited Job handle when the owning host exits, including before the target is resumed. Job-list rejection fails launch instead of weakening process ownership. Orderly shutdown follows the separate [Job quiescence decision](2026-09-05-crew-windows-job-quiescence.md). Neither decision resolves the Node child-pipe limitation; the [package limitations](../../../../packages/experimental/crew/README.md#known-limitations-and-deferred-work) remain in force.
