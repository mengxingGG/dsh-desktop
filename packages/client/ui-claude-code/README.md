---
description: "Sign in to Claude Code and inspect account quota from DSH settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claude-code

English | [中文](README.zh.md)

## Summary

Sign in through the official Claude CLI, submit an authorization code when requested, cancel a pending login, and refresh account quota without a model request. Main and Crew Agents select Claude Code through their existing model selectors.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The [Web bundle](../../bundle/web-app/README.md) mounts this settings section with the [Claude executor](../../subagent/subagent-claude-code/README.md). Open Settings → Claude Code. Existing native login is reused; signing in runs the official authorization flow. The CLI owns credentials, and the panel forwards a submitted code without retaining it in its store.

Refresh quota reads account-wide windows. Each window shows utilization, reset time and observation time; absent data is unknown. Opening account controls retrieves quota for a signed-in account. Opening a conversation or assigning a Crew role does not itself start Claude inference. The Client's `loginPollMs` configuration controls polling only while a login is running; its default is 1000 milliseconds.

Claude conversations show context occupancy, cache-hit percentage and five-hour/seven-day quota below the composer. Expand the row for the latest native request's input, output, cache-read and cache-write counters, model capacity and observation times. Context occupancy measures the latest request, not cumulative token spending; native compaction clears the previous measurement. Capacity can remain unknown until the first request completes. The visible row refreshes shared quota every `quotaRefreshMs` milliseconds, default 60000, and also offers manual refresh.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host executor owns native operations. Generated Remote methods carry public account observations and login input. A disposable Client controller serializes settings actions, polls active login progress and rejects late results after unload. The renderer binds its observable through the settings slot; the component owns only its unsubmitted authorization-code draft.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Claude Code execution](../../subagent/subagent-claude-code/README.md) — native runtime and account behavior.
- [Crew settings](../ui-crew/README.md) — independent role selections.
- [Web Client architecture](../../../docs/subsystems/web-client.md) — Remote and slot ownership.

-----

<a id="model-experience"></a>
## Model Experience

None, as this UI-only package adds no model-visible content, tools or prompt sections. The selected executor and scoped DSH tool composition determine the Agent's requests.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The account display follows the native CLI's available observations.

- The pinned structured quota command is experimental; incompatible responses report an error.
- Login completion requires the user's official browser authorization. The panel cannot authorize an account automatically.
- Quota refresh pauses while the page is hidden; a displayed timestamp can become stale. Older Sessions without native usage observations show unknown request counters until their next Claude request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** no companion is published. The Host owns account and process state; this package owns presentation and disposable Client registrations.
