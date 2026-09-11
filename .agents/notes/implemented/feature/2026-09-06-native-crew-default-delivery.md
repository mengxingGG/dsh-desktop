# Agent Note: Native Crew ships in the default Web profile

Status: implemented

Manager tools and review flow follow [manager-led Crew delivery](2026-09-11-manager-led-crew-delivery.md); this record's preset publication and default profile decisions remain applicable.

English | [中文](2026-09-06-native-crew-default-delivery.zh.md)

## Problem

The [DSH-native Crew](2026-09-04-dsh-native-crew-orchestration.md) was built as a private experimental family and closed with an explicit condition: "Promotion requires explicit review after the shipped profile evidence; the follow-up decision must consolidate, stabilize, or remove them rather than silently preserving duplication." Its delivery-profile snapshot, restart matrix, browser evidence, policy tests, SDK projections, and provider smoke had since accumulated, so the condition was met and the question was live.

Shipping Crew in a release profile is not a configuration change. [`packages/experimental/AGENTS.md`](../../../../packages/experimental/AGENTS.md) forbids a release package or app from naming an experimental package in `dependencies`, and the dsh release family excludes that directory. A `web` profile template that installs the Crew bundles therefore cannot leave those bundles under `packages/experimental/`.

The Team domain, its nine model-facing tools, its Web roster, and its two standalone profile layers were all experimental together, even though Crew consumes only the domain. Promoting the family as one unit would ship a second, direct-to-model team surface that no product path uses.

## Decision

Native Crew is part of the default Web experience. `PROFILE_TEMPLATES.web` installs `@deepseek-ai/dsh-crew-profile` and `@deepseek-ai/dsh-crew-web-profile` after the base and Web application bundles, so `dsh web` gets Crew tools, the Crew details column, and the [orchestration Agent preset](2026-09-06-crew-orchestration-agent-preset.md) without a plugin step.

Six packages are promoted along the [promotion rule](../../../../packages/experimental/AGENTS.md): each moves out of the experimental group into its product-role group, drops `experimental-` from its npm name, clears `private`, and declares `publishConfig.access: public`. Every directory keeps its name except the browser plugin, which takes its group's `ui-` prefix.

| Role | Location | npm name |
|---|---|---|
| Team domain | [`packages/subagent/agent-team`](../../../../packages/subagent/agent-team/README.md) | `@deepseek-ai/dsh-agent-team` |
| Crew domain | [`packages/subagent/crew`](../../../../packages/subagent/crew/README.md) | `@deepseek-ai/dsh-crew` |
| Crew tools | [`packages/subagent/tool-crew`](../../../../packages/subagent/tool-crew/README.md) | `@deepseek-ai/dsh-tool-crew` |
| Crew Web UI | [`packages/client/ui-crew`](../../../../packages/client/ui-crew/README.md) | `@deepseek-ai/dsh-client-ui-crew` |
| Crew Host profile | [`packages/bundle/crew-profile`](../../../../packages/bundle/crew-profile/README.md) | `@deepseek-ai/dsh-crew-profile` |
| Crew Web profile | [`packages/bundle/crew-web-profile`](../../../../packages/bundle/crew-web-profile/README.md) | `@deepseek-ai/dsh-crew-web-profile` |

The Team domain is promoted because Crew depends on it for membership, mailbox, task ownership, and advisory write scopes; a shipped Crew cannot rest on an experimental dependency.

The direct-to-model Team surface stays experimental and private: `dsh-experimental-tool-agent-team`, `dsh-experimental-client-ui-agent-team`, `dsh-experimental-agent-team-profile`, and `dsh-experimental-agent-team-web-profile`. Crew reaches Team through `ctx.agentTeams`, not through those tools, so nothing on the shipped path needs them. They remain reachable through their own profile layers and stay in `apps/cli` `devDependencies` for the Team e2e coverage.

Promotion moves paths and names, not contracts. The Crew capability remains pre-stable: its model schemas, durable records, and profile declarations still evolve with their consumers, and each promoted package's README continues to say so. Public npm names are what changed, not a compatibility promise.

## Alternatives considered

- **Keep every Crew package experimental and require `dsh plugin add`.** Rejected because the delivery evidence the [orchestration note](2026-09-04-dsh-native-crew-orchestration.md) required already existed, and because a default Web profile that installs experimental bundles violates the release-exclusion rule the experimental subtree exists to enforce. The choice was to ship or not to ship, not to ship from `packages/experimental/`.
- **Promote the whole Agent Teams family with Crew.** Rejected because it would publish a second team-coordination surface — nine model tools and a roster UI — that no shipped product path consumes, and would commit their contracts before any product validated them. Only the domain Crew actually depends on is promoted.
- **Remove the experimental Team tools and UI instead.** Rejected as premature: they are the only surface exercising generic Team membership and messaging outside Crew's software workflow, and their e2e coverage is what keeps the domain honest about non-Crew consumers.
- **Keep the `experimental-` npm prefix after moving the directories.** Rejected because the prefix is the release signal that the workspace-constraints gate and the release family read; a package that ships must not be named as if excluded, and two sources of truth for "is this released" would drift.

## Consequences

`dsh web` now delivers Crew by default, so the Crew Host and Web layers are on the shipped release payload and their contracts are exercised by every default Web user rather than by an opt-in profile. Pre-stable remains the stated status, which is what limits the promise the public npm names would otherwise imply.

Every import, Cordis configuration row, generated catalog, tsconfig entry, and documentation reference had to move atomically with the directories. The [orchestration-preset change](2026-09-06-crew-orchestration-agent-preset.md) found the documentation half of that incomplete — roughly 120 stale `packages/experimental/…` links across generated catalogs, subsystem pages, the group map, and the development plan — and completed it. The lesson is that a promotion is only done when `verify-package-paths` and `verify-md-links` pass, not when the code compiles.

The Agent Teams group is now split across two lifecycles: a released domain in `packages/subagent/agent-team` and four private consumers in `packages/experimental/`. That split is deliberate, but it means the experimental consumers must keep depending on a released package, which the experimental rules already permit, and that a later decision about them cannot be a whole-family move.
