# Agent Note: Windows tray and confirmed durable exit

Status: implemented

English | [中文](2026-09-05-windows-tray-durable-exit.zh.md)

## Problem

Closing a desktop window must distinguish hiding active work from stopping the application. A stored unfinished task is not proof of live execution, and killing a Windows process before enumerating its descendants can orphan them. Cordis unload logs disposer failures, so unload fulfillment alone cannot prove that Session writes succeeded.

## Decision

The [desktop shell](../../../../apps/desktop/README.md) owns the Windows tray and native confirmation dialogs. Hiding leaves the backend untouched. Exit inspects live work; declining confirmation changes no task state. The backend rechecks an unconfirmed shutdown request before starting preparation. Native copy uses typed Chinese and English dictionaries selected by the application locale.

The shell appends the Web bundle's `desktop.patch.yml` for its own launch only. Its private inherited IPC protocol carries numbered activity and shutdown messages, not prompts or credentials. Ordinary Web launches and renderers expose no shutdown API.

`dsh-cmdline` declares `app/active-work` as a synchronous bail event and `app/prepare-exit(stage)` as an awaited parallel event. The application awaits `producers`, then `agents`. Producers close admission, cancel and drain their work, and reject unverifiable cleanup. Crew stops scheduling notifications before Agent factories close their write handles. Agent factories report startup, turns, and between-turn maintenance; their shared shutdown joins every owned disposal and retains failures across repeated requests. The final activity check and `sessionPersistence.flush()` must succeed before root unload and the `prepared` IPC reply.

The backend retains its IPC channel after preparation so the parent can enumerate the still-live Windows root and terminate its entire process tree before Electron exits. The parent never maps `prepared` to process exit without performing and awaiting tree cleanup. A failed or timed-out request leaves the shell open; only an explicit Force exit choice permits termination without a durability acknowledgement. Shutdown preserves recorded history, not live execution or a promise to replay queued input automatically.

This supplements the [desktop distribution decision](2026-08-24-cross-platform-desktop-shell.md), which remains active for Web/profile ownership and direct-versus-installed runtime packaging.

## Alternatives considered

**Hide on every close without asking.** Rejected because users must be able to distinguish background execution from complete exit.

**Check only displayed task status.** Rejected because idle Sessions can retain unfinished records, and maintenance or subprocess work can remain active outside a visible Agent turn.

**Kill first or treat Cordis unload as a save acknowledgement.** Rejected because cancellation events may still be buffered and unload contains disposer failures. Explicit task-owner preparation and durable flush preserve a verifiable failure path.

**Expose an HTTP shutdown route.** Rejected because only the owning desktop process needs this authority; inherited IPC avoids adding a remotely callable operation.

## Consequences

Normal exit requires successful preparation and process-tree cleanup. An unresponsive producer or storage failure can prevent normal exit; the warning makes the unsaved-state trade-off of Force exit explicit. Custom task producers must participate in preparation and activity reporting. No external CLI adapter or alternate operating-system validation is added.

Unit tests exercise confirmation races, producer admission, maintenance cancellation, close/flush failures, and replayable JSONL history. Native Windows tests observe descendant process handles and run the shipped Web profile with both idle and streaming keyless tasks.
