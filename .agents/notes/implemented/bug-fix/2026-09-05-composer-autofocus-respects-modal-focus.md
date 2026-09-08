# Agent Note: Composer autofocus respects modal focus

Status: implemented

English | [中文](2026-09-05-composer-autofocus-respects-modal-focus.zh.md)

## Problem

Adding a Workspace starts a blank Session asynchronously. The user can open the directory picker again and edit a path before that Session finishes opening. Unconditional composer autofocus then moves focus out of the picker, whose blur handler cancels the path draft. A slow Session creation can therefore discard an unrelated editing interaction.

## Decision

The [composer](../../../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx) yields its mount, unlock, and Session-switch autofocus when focus is inside a modal that does not contain the composer. The modal keeps keyboard input; a non-modal control or a modal containing the composer does not suppress normal autofocus. Ordinary composer focus retains `preventScroll` and Lexical selection restoration.

This rule belongs to the code requesting focus, not to directory navigation or Session creation. It adds no global focus trap, delayed refocus, or Host state. [Lexical editor ownership](../architecture/2026-08-20-web-composer-lexical-editor.md), the [single Workspace creation route](../simplification/2026-07-31-one-route-to-add-a-workspace.md), and [onboarding's explicit inert lifetime](../feature/2026-08-13-shared-modal-product-onboarding.md) remain independent decisions.

## Alternatives considered

**Wait for the first Agent in the test before opening another picker.** Rejected because users can perform both actions concurrently; serializing the fixture would hide the product defect.

**Remove composer autofocus entirely.** Rejected because ordinary Session selection needs to return typing to the composer. Only an existing external modal focus takes precedence.

**Change the shared Modal into a global focus trap.** Deferred because that changes every dialog's keyboard behavior. The reproduced unwanted focus request has one local owner and can be withheld there.

## Consequences

Pending Session creation does not cancel an open directory draft. The picker retains its existing blur-to-cancel behavior when the user actually moves focus away. Closing a modal does not replay an autofocus request that was suppressed while it held focus.

The [InputBar tests](../../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx) cover unlock, Session switch, non-modal controls, and a composer inside its own modal. The [Workspace browser scenario](../../../../apps/web/tests/workspace-management.e2e.ts) holds the first real Session creation until a second picker has a typed draft, then verifies focus and continued typing after creation completes. The controlled overlap reproduces the original failure without sleeps or retries.
