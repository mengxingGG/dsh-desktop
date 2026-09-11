# Agent Note: Crew orchestration as a selectable Agent preset

Status: implemented

Manager tools and review flow follow [manager-led Crew delivery](2026-09-11-manager-led-crew-delivery.md); this record's preset publication and default profile decisions remain applicable.

English | [中文](2026-09-06-crew-orchestration-agent-preset.zh.md)

## Problem

The [DSH-native Crew](2026-09-04-dsh-native-crew-orchestration.md) shipped with one engagement rule for every session: the manager policy told the model to handle simple requests directly and to act as a Crew manager when the user asked for a development team or when work benefited from independent implementation and review. Whether a request was orchestrated was therefore a model judgement made per turn, on a session whose ordinary preset still supplied bash, filesystem writes, subagents, and workflows. A user who wants every change to go through specification, dispatch, host verification, and independent review had no way to say so, and no way to remove the shortcut: the model could always decide the work was simple and edit the file itself.

The Crew profile already carried a `crew-manager` Agent preset with the right composition — persona and repository instructions only — but nothing published it to the roster, so no session could select it, and the manager policy contradicted it by asserting the manager retains its ordinary tools.

## Decision

Crew orchestration is a per-session choice expressed as an Agent preset. `crew-manager` is that preset, shipped by `@deepseek-ai/dsh-crew-profile` and published to the Web roster by `@deepseek-ai/dsh-crew-web-profile` as a second read-only `system` root. The deployment default stays `standard`: an ordinary preset keeps its full tool set and the discretionary policy, so the existing behavior is what a user gets until they choose otherwise.

The composition is the enforcement, not the prompt. `crew-manager` names persona, repository instructions, ask-user, todos, skills, plan mode, and compaction — a coordination surface with no route to project code. The `crew_*` manager tools are deliberately absent from the file: `dsh-tool-crew` installs them from the Host layer on whichever Agent is the Team lead, so the preset chooses only what the manager has besides them. A session running it can read and write through the durable Crew path scopes and can dispatch, but cannot run a shell, reach the filesystem outside those scopes, spawn a subagent, or start a workflow. A prompt-only mandate was rejected for exactly this reason: an instruction the model can reconsider is not a guarantee.

`loadCrewProfilePresets` enforces the composition with an allowlist of coordination modules rather than a list of forbidden capabilities, and flattens group rows before checking, because a capability nested one level inside a `cordis:group` would otherwise pass a top-level scan. A denylist admits every plugin added after it was written; an allowlist fails activation until someone edits both the composition and the list.

Engagement and mechanics have separate homes. `dsh-tool-crew` owns the mechanics — module scopes, versioned specifications, declared verification commands, status revisions, review before integration, wait semantics, and commit approval — which are identical for every manager. It no longer asserts which tools the manager has or when to handle work directly; it names the three cases that engage a Crew, one of which is an Agent preset that mandates orchestration. The `crew-manager` persona states that mandate, and `presets/roles/manager.yml` carries the same text byte for byte, checked at activation. A per-session fact belongs to the composition that varies per session, not to a Host-plane plugin configured once per profile.

The roster patch sits in the Web layer because `dsh-web-app` owns the `agent-presets` row. A headless profile carrying only the Host Crew layer has no roster to patch, and its manager keeps the discretionary policy. A patch replaces the targeted row's whole `config`, so the Web layer restates `default: standard` beside the added root.

## Alternatives considered

- **Make the engagement rule a `dsh-tool-crew` config field.** Rejected because `tool-crew` is one Host-plane row: a field there selects one policy for the whole profile, while the fact being expressed varies per session. The preset is already the per-session composition seam.
- **Resolve the policy from the agent's selected preset id inside `dsh-tool-crew`.** Rejected because it couples a Host-plane Consumer to the preset roster's projection to read a value the preset can simply state itself, and it makes a preset's own persona and the plugin's policy two authorities for one fact.
- **Ship the preset in `dsh-agent-presets` beside `standard`.** Its composition names no Crew module, so it would load anywhere — and silently do nothing in a profile without the Crew layers, giving the user a manager persona and no manager tools. Shipping it with the layer that supplies the tools keeps the failure impossible instead of quiet.
- **Add a second preset and leave `crew-manager` as it was.** Rejected as duplication: the two compositions would differ only in display copy, and `assertManagerAgentPreset` would need two parallel checks. `crew-manager` already was the restricted manager composition; it lacked a roster and a mandate, not a sibling.
- **Keep the full standard tool set and add a mandatory policy section.** Rejected because it leaves the shortcut in place. A model that concludes the change is trivial edits the file, and the recorded evidence chain — specification, verification, review, integration — never exists for that change.
- **Add a `tools/pre-execute` guard rejecting non-Crew mutations.** Rejected as redundant with a composition that never registers those tools, and as a second place to keep in sync with the first.

## Verification

- `packages/bundle/crew-profile/tests/profile.spec.ts` pins the exact module list the preset composes, and rejects an implementation tool added at the top level, one hidden inside a group row, and a persona that drifts from the manager role preset.
- `packages/bundle/crew-web-profile/tests/profile.spec.ts` pins the patched roster row: the injected service, the added root expression, and `default: standard`.
- `packages/preset/agent-presets/tests/display.spec.ts` and `packages/client/ui-agent-preset/tests/locales.client.spec.ts` cover the localized picker copy for a preset shipped by a bundle rather than by the roster package.
- `apps/web/tests/crew-panel.e2e.ts` keeps the shipped Host and Web layers equal to its overlay, so the roster patch cannot drift from the layer the browser scenarios run.
- The Crew snapshot expectations carry the manager policy the model actually receives.

## Consequences

A user who selects Orchestration mode gets a manager that cannot quietly do the work itself, and the recorded evidence chain applies to every change in that session. The cost is a preset whose capabilities are deliberately narrower than any other shipped one: a request that needs a shell, a file outside the Crew scopes, or a subagent is refused rather than served, and the user switches presets — which a session can only do before it has produced anything.

The Web layer now restates the roster row, so a deployment that changes the default preset or adds its own roots must patch `agent-presets` after this layer and restate this layer's root too. Nothing merges the two.

The module allowlist makes the preset's composition a two-file edit. That is the intended friction: it is what stops a later capability from reaching the manager without a decision.

The manager policy no longer describes the tools the manager has, because that is now preset-dependent. A future preset that mandates orchestration under a different name states its own mandate the same way; `dsh-tool-crew` needs no change to accept it.
