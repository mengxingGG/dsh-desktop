# Agent Note: Crew Windows cleanup waits for Job and process exit

Status: implemented
Archived: 2026-09-06

English | [中文](2026-09-05-crew-windows-job-quiescence.zh.md)

## Problem

A command's direct process can exit while a detached descendant still runs without holding either output pipe. Closing the last kill-on-close Job handle requests termination but also removes the launcher's way to observe the whole Job. Output EOF and a direct-process exit therefore cannot independently establish process-tree quiescence before private execution files are removed.

## Decision

The [Crew Windows launcher](../../../../packages/experimental/crew/src/execution-windows.ts) retains its private Job handle during orderly cleanup. Parent exit, cancellation, and exceptional cleanup share one termination operation. It sets the Job's active-process limit to zero to reject new admission, captures native handles for the listed members including nested Jobs, and calls `TerminateJobObject`. It waits for zero active processes and for every captured process handle to become signaled before closing native resources. The same configured grace period bounds member enumeration, termination observation, and output drainage.

Microsoft documents the [admission limit](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information), [nested-member list](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list), [Job accounting](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information), and [termination API](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject). A zero active count does not replace process-handle waits: native tests observe that both direct and detached-descendant handles can remain unsignaled after the count reaches zero. Captured PID handles are waited on, never individually terminated; a PID disappearing before handle acquisition already establishes its exit, while any other acquisition failure rejects cleanup.

API failure or grace expiry rejects the command. Final handle closure retains kill-on-close containment if explicit termination or observation fails, but that fallback is not reported as verified quiescence. File grants, network denial, creation-time association, and the installed Node runtime are unchanged.

The [creation-time Job decision](2026-09-05-crew-windows-creation-time-job.md) remains independently necessary when the host disappears before orderly cleanup. The [shared Win32 primitives](../architecture/2026-08-19-shared-win32-process-primitives.md), [Windows ACL sandbox](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md), and [native Crew workflow](../feature/2026-09-04-dsh-native-crew-orchestration.md) retain their distinct API, policy, and durable-state decisions.

## Alternatives considered

**Close the Job and wait only for pipe EOF.** Detached descendants can hold no output pipe, so EOF does not observe their lifetime.

**Wait only for the direct process or Job accounting.** A direct-process exit does not imply that descendants have stopped. Job accounting can also settle before individual process exit signals, so both shortcuts miss detached-descendant teardown.

**Wait on the Job handle as a generic completion event.** Microsoft's [Job documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) defines its signaled state for a specified end-of-job time limit, not for arbitrary command termination.

## Verification

The [native suite](../../../../packages/experimental/crew/tests/execution-windows.spec.ts) uses an atomically published readiness file and a host-controlled release barrier. It opens the live detached descendant's native process handle, verifies membership in the exact private Job, and checks exit before the command returns after parent exit or cancellation. It also verifies that the launcher waits on that member and that a real creation attempt after zero admission is rejected. Job-handle release observes zero active processes. The pre-fix observations expose both a live descendant at Job-handle release and an unsignaled descendant after command return.

Injected native failures cover resume, pipe reads, direct waits, admission closure, member enumeration, Job termination, Job queries, pending accounting, pending process exit, and output-drain expiry. Real termination and handle observations pin exceptional cleanup where the relevant native APIs remain available. Every invocation owns its snapshot, profile, handles, and teardown; independent test processes use separate resources.

This change does not alter Session payloads or Web presentation. The [execution suite](../../../../packages/experimental/crew/tests/execution.spec.ts) remains the separate owner of confined command behavior and piped descendants. Node 24.14's child-pipe limitation is not resolved by these cleanup tests.

## Consequences

Orderly cleanup closes process admission and observes each captured member's exit before releasing its resources. It owns additional wait handles and pays the configured polling delay when Windows has not completed termination. An unobservable or late exit fails instead of producing successful verification evidence. Abrupt host exit still relies on the non-inherited kill-on-close handle, without a claim that the terminated host can observe completion.
