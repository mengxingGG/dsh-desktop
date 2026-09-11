---
description: "Native CLI account settings and invocation counters in the conversation composer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cli-agents

English | [中文](README.zh.md)

## Summary

Adds an External CLIs settings section for Grok, Antigravity and Codex, and displays native invocation counters below conversations using these routes. The [Host executor](../../subagent/agent-cli/README.md) owns account and execution behavior.

## Table of Contents

- [Account controls](#account-controls)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="account-controls"></a>
## Account controls

Opening settings refreshes available models without inference. Client `loginPollMs` configures cached terminal-status polling while native login is open. Login starts only after the user's action and exposes bounded native terminal output, authorization links, explicit input and cursor/Enter controls. Closing login drains the terminal and refreshes models. Credentials remain in the native CLI. Grok's auxiliary directory does not establish a logged-out account; unverified authentication is shown as unknown.

Antigravity quota queries are manual and explain their possible request cost. Grok quota has no fabricated progress bar. Native usage comes from the persisted `cliUsage` projection; unavailable metrics remain unknown. The package owns no independent runtime invariant: account lifecycle and execution state belong to the Host.

Codex manual quota queries need no model request and display the actual account pools and reset times; absent reset times stay unknown. Model selectors use the native model directory and reasoning levels. The composer displays the latest invocation's input, output and cached input, with context occupancy and capacity when reported. Cached quota reflects the most recent manual query.

<a id="model-experience"></a>
## Model Experience

None, because the settings and composer slots add no model-visible content. The selected Host executor owns native prompts and tools.

#### KV Cache effect

None.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

Native login terminal output is displayed as bounded text rather than a terminal emulator. The Host may reject unavailable native quota commands. This delivery has compilation evidence only; browser and real-account acceptance are left to the user.

## Dev Note

The [Web Client subsystem](../../../docs/subsystems/web-client.md) owns slot and Remote conventions.
