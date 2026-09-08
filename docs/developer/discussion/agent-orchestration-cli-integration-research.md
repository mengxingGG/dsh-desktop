# External agent CLI integration research

English | [中文](agent-orchestration-cli-integration-research.zh.md)

This document records the 2026-09-04 local and primary-source investigation of Claude Code, Codex, Grok, and Antigravity. It selects future integration protocols without placing any external CLI on the first DSH-native orchestration milestone.

## Summary

The first milestone should use the current DSH Agent as the manager and DSH continuable subagents as workers. External products belong behind the existing subagent capability after that workflow is authoritative, recoverable, and visible in the Web client. Gemini CLI is out of scope.

Claude Code should later use the system installation through its streaming JSON protocol; the fixed binary in `C:\Users\admin\Desktop\workspace\claudecodeDesktop` is a protocol reference only. Codex should use `codex app-server` for durable interactive workers, Grok should use its ACP server, and Antigravity should use the supported `agy` headless CLI once that separate CLI is installed and authenticated. The Antigravity Desktop application's private language server is not an integration surface.

## Contents

- [Decisions](#decisions)
- [Local evidence](#local-evidence)
- [DSH baseline](#dsh-baseline)
- [Claude Code](#claude-code)
- [Codex](#codex)
- [Grok](#grok)
- [Antigravity](#antigravity)
- [Normalized provider obligations](#normalized-provider-obligations)
- [Recommended integration order](#recommended-integration-order)
- [Evidence still required](#evidence-still-required)
- [Sources](#sources)

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| First implementation provider | DSH-native manager and workers | No external CLI process is required to validate the orchestration core. |
| Gemini CLI | Excluded | Antigravity support must not be implemented by relabeling Gemini CLI. |
| Claude executable | Resolve the user's system Claude Code | Never launch or copy the fixed binary or its private configuration from `claudecodeDesktop`. |
| Durable Codex transport | `codex app-server` | Keep one protocol connection and use thread and turn lifecycle methods; reserve `codex exec` for one-shot fallback or diagnostics. |
| Durable Grok transport | ACP over stdio | Extend the general ACP-backed continuable child path instead of defining Grok-specific transcript events. |
| Antigravity transport | Official `agy` stream JSON | Do not call the Electron application's internal language server. |
| Authentication | Provider-owned interactive login plus read-only preflight | DSH neither extracts credentials nor infers one product's CLI authentication from its desktop UI. |
| Provider API | Capability-advertising continuable child provider | The manager, crew domain, and UI must not depend on provider-specific event fields. |

## Local evidence

The following observations are a point-in-time snapshot from this machine. Login secrets and authentication files were not read.

| Product | Local observation | Integration implication |
|---|---|---|
| Claude Code | The system wrapper is `C:\Users\admin\AppData\Roaming\npm\claude.cmd`; version `2.1.251`; `claude auth status --json` reports a first-party OAuth login. | Resolve the system wrapper explicitly when the inherited service PATH omits `%APPDATA%\npm`; inherit the user's normal Claude configuration. |
| `claudecodeDesktop` | Its Electron bridge launches a bundled `claude-engine\claude.exe`, keeps stdin open, consumes stream JSON, answers control requests, interrupts turns, and resumes sessions. | Reuse protocol and lifecycle lessons only. Do not reuse its binary, private `CLAUDE_CONFIG_DIR`, or packaged runtime. |
| Codex | The Desktop-bundled executable reports `codex-cli 0.153.0-alpha.5`; `exec`, `resume`, `fork`, and `app-server` are present. `codex login status` on that standalone executable reports “Not logged in.” | Treat Desktop account state and standalone CLI preflight as separate observations. A future adapter must expose this mismatch before dispatch. |
| Grok | `C:\Users\admin\.grok\bin\grok.exe` reports `grok 1.0.5`; it exposes `agent stdio`, headless streaming output, continuation, resume, fork, schema, sandbox, and permission options. | ACP is locally available and is the preferred long-lived transport. |
| Antigravity | Antigravity Desktop `2.11.0` is installed under `C:\Users\admin\AppData\Local\Programs\antigravity`. No `agy` command or expected `agy.exe` was found. | Desktop availability does not satisfy the supported headless CLI prerequisite. Install and authenticate `agy` before adapter implementation or e2e validation. |

The reusable Claude reference entry points are `C:\Users\admin\Desktop\workspace\claudecodeDesktop\electron\code-engine\spawn.js`, `electron\code-engine\protocol.js`, and `electron\auth-manager.mjs`. They show transport framing, process control, and provider-owned authentication delegation without making that project's packaged runtime a dependency.

## DSH baseline

DSH already owns most of the generic lifecycle. The [subagent service](../../../packages/subagent/subagent/README.md) supports continuable children, durable descriptors, cold resume, FIFO follow-ups, interruption, and discovery. The in-process spawn and fork providers already implement that lifecycle for DSH-native Agents.

The current external providers are narrower than the proposed product. [Claude Code](../../../packages/subagent/subagent-claude-code/README.md) and [Codex](../../../packages/subagent/subagent-codex/README.md) run bounded delegated tasks through pinned SDK/runtime dependencies; [ACP](../../../packages/subagent/subagent-acp/README.md) runs one ACP process per request. None currently supplies the pooled continuable process, human approval relay, durable provider session binding, progress projection, and Crew-specific policy required here.

This is an API integration task, not a reason to bypass the current capability seam. Each future adapter must either implement `prepareContinuable` and the existing lifecycle or deliberately update every consumer of a revised subagent API.

## Claude Code

### Supported protocol

The official headless interface supports print mode, stream JSON input and output, JSON Schema output, session resume and fork, explicit session IDs, tool allowlists, permission modes, extra directories, MCP configuration, system-prompt extension, budget limits, and effort selection. A long-lived process can accept multiple user events through stdin and emit system, assistant, user, control, and result events.

The locally installed version confirms the required flags. The `claudecodeDesktop` bridge also demonstrates two lifecycle details worth retaining in tests: write the first input before waiting for initialization, and keep stdin open between turns. Control requests must receive control responses, and interruption must end the active turn without discarding the durable session identity.

### DSH adapter decision

Resolve `claude.cmd` from the configured absolute path or the user's command lookup, verify `claude --version`, then run `claude auth status --json` before enabling the provider. Do not set `CLAUDE_CONFIG_DIR`; the system installation must inherit the user's authenticated configuration. Stream events are normalized into DSH child lifecycle and approval events, while the raw provider fields remain result metadata for diagnostics.

The adapter must not reuse `C:\Users\admin\Desktop\workspace\claudecodeDesktop\claude-engine\claude.exe`. That project is evidence for framing, control requests, cancellation, and resume behavior only.

### Required validation

- Start and complete a two-turn continuable task through the system binary.
- Resume the same provider session after the DSH process is restarted.
- Relay allow, deny, and interrupted permission requests without exposing a worker input box.
- Prove that the provider inherits the system account and never reads or persists a token.
- Feature-detect flags and event variants so a version change fails with an actionable provider diagnostic.

## Codex

### Supported protocol

`codex exec --json` emits JSONL events and supports output schemas, sandbox selection, additional directories, continuation, resume, and fork. It is suitable for bounded work and a useful conformance smoke.

`codex app-server` is the better durable transport. It exposes bidirectional JSON-RPC over JSONL stdio, beginning with initialization and continuing through thread start, resume, fork, turn start, streamed items, and server-initiated approval requests. A Crew worker maps naturally to a Codex thread; each append maps to another turn.

### DSH adapter decision

Use one supervised app-server process for the provider scope and persist the provider thread ID in the DSH continuable child descriptor. DSH owns restart, reconnect, thread resume, approval policy, interruption, and normalized projection. `codex exec` remains a one-shot fallback and a release smoke, not the primary Crew runtime.

The local standalone binary's “Not logged in” result must appear as a provider preflight failure even when Codex Desktop is logged in. Implementation must determine and document the supported system CLI installation and authentication path rather than silently depending on a Desktop-bundled executable.

### Required validation

- Initialize app-server and feature-detect the methods used by the adapter.
- Start, append to, interrupt, and resume one thread across a provider-process restart.
- Exercise a server-initiated approval with allow-once, allow-for-session, and deny outcomes supported by the installed protocol.
- Prove sandbox and additional-directory policy for an allowed module and a denied sibling path.
- Run an authenticated real-product smoke only after `codex login status` succeeds for the selected executable.

## Grok

### Supported protocol

The installed Grok CLI exposes an ACP server over stdio. The official implementation documents initialization, `session/new`, `session/prompt`, streamed `session/update` notifications, structured message/reasoning/tool updates, and permission requests. It also exposes headless streaming formats and continuation flags, but ACP avoids inventing a Grok-only interaction model.

### DSH adapter decision

Extend the existing ACP provider into a continuable, supervised session provider and select Grok through configuration. Capability discovery comes from ACP initialization. DSH must not assume xAI extensions when a standard ACP field is sufficient, and provider-specific metadata must not leak into the Crew domain.

Do not enable unconditional approval. The installed CLI's `--always-approve` mode is useful only for isolated diagnostic fixtures; production behavior must compose DSH policy, provider permission requests, and the worker's path and command restrictions.

### Required validation

- Keep one ACP session alive for two prompts and restore it after process failure where the protocol permits.
- Project message, reasoning, tool, permission, and terminal outcomes without duplicating Crew events.
- Deny an out-of-scope write and prove the denial is durable and visible to the manager.
- Detect unsupported ACP capabilities at load or the earliest resolvable dispatch point.
- Run a real authenticated smoke without reading `~/.grok/auth.json`.

## Antigravity

### Supported protocol

The supported automation surface is the separate `agy` CLI. Its headless mode supports text, JSON, and stream JSON output, conversation IDs, continuation, explicit conversation selection, JSON Schema output, and a long-lived stream JSON stdin mode with one result per turn.

Headless Antigravity does not provide an interactive permission channel. Protected operations must be pre-granted or are denied; sending control request or response events is documented as an error. The normalized DSH capability advertisement must therefore report no online approval relay for this provider.

### DSH adapter decision

Do not reverse engineer `resources\app.asar` or invoke the Desktop application's internal `language_server.exe`. Those components use private startup arguments and loopback services and are not the documented external interface.

Implementation is blocked only for this later adapter until `agy` is installed and its own authentication preflight succeeds. The core Crew work does not depend on it. Once present, persist the conversation ID as the provider session binding, keep stdin open for continuations when healthy, and use conversation resume after process restart.

### Required validation

- Probe `agy` independently from the Antigravity Desktop installation.
- Confirm authentication, model selection, one-shot JSON, long-lived stream JSON, continuation, schema enforcement, and interruption against the installed version.
- Prove that protected calls follow preconfigured policy and never wait for a nonexistent interactive approval channel.
- Resume a recorded conversation after adapter-process restart.
- Fail clearly when only Antigravity Desktop is installed.

## Normalized provider obligations

The provider interface should expose verified capabilities instead of a product-name switch in Crew. A capability is true only after version-aware probing establishes the required command or protocol method.

| Obligation | Meaning |
|---|---|
| Executable resolution | Return the selected absolute executable, version, and provenance; never silently substitute a bundled binary. |
| Authentication preflight | Report authenticated, unauthenticated, expired, or unknown without reading credentials. |
| Continuation | Start a durable child, append a turn, persist an opaque provider session ID, and resume after host restart. |
| Event normalization | Map provider output to lifecycle, message, tool, approval, error, usage, and result events while retaining diagnostic metadata. |
| Structured result | Request provider-native schema output when available and validate the result at the process or wire boundary. |
| Policy | Compose DSH tool filtering, filesystem and shell restrictions, provider sandbox settings, and approval behavior. |
| Cancellation | Interrupt an active turn, enforce a bounded shutdown, and retain or explicitly invalidate the provider session. |
| Backpressure | Bound unread output, serialize appends per child, and preserve FIFO ordering across reconnects. |
| Error taxonomy | Distinguish executable, version, authentication, quota, network, permission, protocol, cancellation, and model failures. |
| Observability | Persist model-visible inputs and normalized outcomes in the DSH Session log; keep raw high-volume diagnostics outside the model context. |

## Recommended integration order

1. Complete and ship the DSH-native Crew workflow described in the [core development plan](agent-orchestration-core-development-plan.md).
2. Implement system Claude Code because its executable and login are verified locally and the reference desktop project supplies tested lifecycle lessons.
3. Upgrade the generic ACP provider and enable Grok as its first continuable external configuration.
4. Implement Codex app-server after resolving the standalone CLI authentication preflight on this machine.
5. Install and authenticate `agy`, then implement Antigravity without any Gemini CLI compatibility layer.

Each adapter is a separate change with its own Agent Note, package documentation, focused unit and process tests, authenticated real-product smoke, and recorded-session snapshot when model-visible output changes. No adapter should be merged merely because `--help` lists the expected flag.

## Evidence still required

No paid model task was sent during this investigation, so live turn behavior, quota signals, approval round trips, and restart recovery remain unverified for all four products. Claude and Grok authentication files were not opened. Codex Desktop login was accepted as user-provided context, while the inspected standalone CLI reported a different state. `agy` was not installed locally, so Antigravity findings are documentation-backed rather than runtime-backed.

The implementation phase must repeat version and authentication probes, capture sanitized protocol fixtures, and convert each claimed lifecycle into a deterministic test before advertising the provider in settings.

## Sources

- Claude Code [headless mode](https://code.claude.com/docs/en/headless) and [CLI reference](https://code.claude.com/docs/en/cli-reference).
- OpenAI Codex [non-interactive mode](https://developers.openai.com/codex/noninteractive/) and [app-server protocol](https://developers.openai.com/codex/app-server/).
- xAI Grok [agent mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md) and [permissions and safety](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md).
- Google Antigravity [headless CLI](https://antigravity.google/docs/cli/headless/).

<details>
<summary>Development note</summary>

This investigation intentionally records commands, versions, and protocol choices without implementing a provider. The original [v0.2 proposal](agent-orchestration-v0.2.md) remains a requirements-source snapshot; this document supersedes its CLI capability assumptions.

</details>
