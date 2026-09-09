---
description: "Inspect live DSH-native Crew status, worker evidence, integration, and commit outcomes in the manager conversation's right sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-crew

English | [中文](README.zh.md)

## Summary

Inspect active and finished workers, verification, review, integration, and commit evidence beside the manager conversation. The Crew settings section independently selects four role models and lets users view, edit, and delete DSH-global operating memory. Worker evidence remains read-only; the panel has no worker input field.

## Table of Contents

- [Use this package](#use-this-package)
- [Panel behavior](#panel-behavior)
- [Global settings](#global-settings)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it through [`@deepseek-ai/dsh-crew-web-profile`](../../bundle/crew-web-profile/README.md), which supplies the Host Crew service and the manager-only Agent preset. The Host package entry is inert; the Web Client loader mounts `/client`. There are no Client configuration fields.

<a id="panel-behavior"></a>
## Panel behavior

The header action appears only on a root manager Session. Its badge counts work items that have not reached `accepted`, `failed`, or `cancelled`. Opening it selects the Crew tab in the right sidebar. Each Session retains its own worker selection while tool details and workspace files remain available in adjacent tabs.

Panel separators and neutral outlines use the shared theme's 0.5px hairlines.

The panel derives manager attention state and stage labels from durable Crew values. Selecting a worker shows its shortened child Session id, reason, changed and rejected paths, missing artifacts, structured report, bounded command outcomes, and review issues. Integration and commit cards show only recorded host evidence. Loading, reconnecting, unavailable, empty, and replay-failure states remain distinct, with English and Chinese copy registered through the locale service.

Verification and integration commands expand through keyboard-operable disclosures. Each command shows its recorded working directory, exit code, signal, and timeout independently. Standard output and standard error remain separate plain-text, keyboard-scrollable regions with a bounded display height; empty output and host truncation have distinct labels. Opening a log does not run a command or contact a worker.

Review details retain the frozen specification revision, round, reviewer, verification reference, and each issue's expected correction. Integration details expose the frozen work-item inputs alongside tests and issues. Commit evidence keeps full approval and integration references, requested paths, and the recorded hash or refusal reason. Requested paths are not proof that staging occurred: checkout drift can reject a request before Git staging.

<a id="global-settings"></a>
## Global settings

The Settings dialog's **Agent orchestration** section stores role defaults and operating memory through the Host's `crew-preferences` namespace. Its data belongs to DSH user settings, not the selected project or browser storage. Existing manager and worker Sessions retain their model binding; new Sessions resolve the current role defaults. Model choices that disappear from the catalog remain visible and removable.

Memory entries distinguish operating preferences from explicitly scoped standing authorization. Saving authorization requires the user's dedicated confirmation; repeated past approvals are not permission. Edits retain the revision observed when the editor opened, so a concurrent update cannot be overwritten. Deletion requires confirmation and affects future memory reads, not historical Session logs. Nonlocal browser-memory mode and unwritable Host settings disable writes.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client mount registers locale dictionaries, a conversation-header action, a `sidebarRightTabs` contribution, and its `sidebar.right.pane.tab` body. `useProjection('crew')` reads the Session projection already distributed by the stable Client session layer; the package does not poll the Host or keep a second workflow store. Every registration is an effect and disappears when its plugin fiber unloads.

Worker activity retains a secondary Session observation and uses the existing Chat projection for streamed text, reasoning, tool calls, results, errors, and paged history. Opening it never selects the child or starts a model turn. Switching workers or closing details releases the observer; reopening reads the durable child history. The view displays the latest 100 nodes and expands history on demand.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Locale, header action, and typed details-branch registration |
| [`src/client/CrewAction.tsx`](src/client/CrewAction.tsx) | Manager-only trigger and active-work count |
| [`src/client/CrewDetailsView.tsx`](src/client/CrewDetailsView.tsx) | Live read-only projection and evidence rendering |
| [`src/client/activity.ts`](src/client/activity.ts) | Secondary child observation and history pagination |
| [`src/client/WorkerActivity.tsx`](src/client/WorkerActivity.tsx) | Read-only streamed child records |
| [`src/client/CrewSettings.tsx`](src/client/CrewSettings.tsx) | Four role selectors and explicit memory edits |
| [`src/client/preferences.ts`](src/client/preferences.ts) | Settings-scope writes and generation-fenced model catalog |
| [`src/client/selection.ts`](src/client/selection.ts) | Typed Crew details selection |
| [`src/client/locales.ts`](src/client/locales.ts) | Key-complete English and Chinese product copy |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Crew Web profile](../../bundle/crew-web-profile/README.md) — additive default Web composition.
- [Crew service](../../subagent/crew/README.md) — authoritative projection and evidence semantics.
- [Right sidebar](../ui-sidebar-right/README.md) — Session-owned tab navigation and selection.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no model prompt, tool, or user message. Its settings controls change Host-owned defaults and memory; the [Crew tool Consumer](../../subagent/tool-crew/README.md#model-experience) owns their logged model-context effects.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only evidence** — remediation, reassignment, integration, and commit remain manager conversation tool actions.
- **Retained output only** — the panel displays the host-retained output, marks each truncated stream, and cannot recover discarded bytes.
- **Root Session only** — child Sessions do not show the trigger and cannot use this panel as a conversation switcher.
- **Provider account controls** — Claude login and quota belong to the [Claude Code settings panel](../ui-claude-code/README.md); Crew members share its executor catalog.
- **One worker view** — selecting another worker releases the previous live observation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** no companion is published. Crew projections and settings revisions retain their existing owners; this package owns presentation and disposable Client registrations.
