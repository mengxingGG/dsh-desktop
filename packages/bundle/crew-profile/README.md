---
description: "Add native Crew roles, scoped workers, durable evidence, and host verification to DSH profiles."
kind: "package-bundle"
---

# @deepseek-ai/dsh-crew-profile

English | [中文](README.zh.md)

## Summary

`dsh-crew-profile` adds native software-team coordination to the selected DSH Agent. The default Web profile includes it; custom profiles can add it after their base and application bundles. Ordinary manager tools and Agent presets remain available, and the package additionally ships one Agent preset that mandates Crew orchestration for the sessions selecting it. Developers, reviewers, and integrators receive independently configured models and assignment-specific tools.

The manager Agent preset places its role text in the persona plugin's `prefix` and explicitly clears `suffix`. Profile validation requires the prefix to equal the manager role file so the same identity reaches both compositions.

## Table of Contents

- [Use this package](#use-this-package)
- [Role presets](#role-presets)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add this layer to an initialized source-checkout profile after its base and application bundles:

```sh
pnpm dsh plugin --profile headless add ./packages/bundle/crew-profile
pnpm dsh --profile headless "Plan two independent modules, dispatch the native Crew, and report verified results."
```

The manager Session cwd is the repository root. The layer records that root on first Crew use, allows at most four concurrent workers, admits only `pnpm`, `npm`, and `node` as declared verification programs, and requires a named branch for local commit. Override deployment values through an additional profile patch; persisted Crew configuration remains immutable for that manager Session.

<a id="role-presets"></a>
## Role presets

The package owns four required YAML role presets. Manager tools supplement the selected Agent preset. Developers receive module-scoped file access plus shared `docs`, `test`, and `tests` directories, declared tests, and reporting. Reviewers can read the complete project and run declared tests; integrators can also write integration changes. Worker presets clear inherited tools before their exact role tools are installed and permit provider, model, and reasoning-effort overrides.

The `crew-manager` Agent preset is the one that mandates Crew orchestration. Its composition is the enforcement: persona, repository instructions, and a coordination surface — ask-user, todos, skills, plan mode, and compaction — and nothing else, so a session running it has no shell, unscoped filesystem, subagent, or workflow tool with which to change project code outside the Crew workflow. The manager persona says the same thing, and the loader compares the two texts byte for byte. Adding a capability means editing the composition and the module allowlist in [`src/index.ts`](src/index.ts) together; a row naming anything outside that list fails activation, including one nested inside a group.

Selecting the preset is the user's per-session choice. Any ordinary preset keeps its full tool set and the discretionary Crew policy, which is what the deployment default stays on. [`@deepseek-ai/dsh-crew-web-profile`](../crew-web-profile/README.md) is what publishes `presets/agents/` to the Web roster; this Host layer only exposes the directory as `ctx.crewProfilePresets.agentPresetRoots`. Missing or inconsistent role declarations fail activation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) validates role presets and publishes `ctx.crewProfilePresets`. [`cordis.patch.yml`](cordis.patch.yml) adds Team, Crew, preferences, invariant, and Crew-tool plugins without replacing ordinary tool rows or the root persona. Manager Session events and child Session descriptors remain authoritative.

| Path | Role |
|---|---|
| [`presets/roles/`](presets/roles/) | Exact persona, tool, route, filter, and depth declarations for all four roles |
| [`presets/agents/crew-manager/`](presets/agents/crew-manager/) | The Agent preset mandating Crew orchestration |
| [`src/index.ts`](src/index.ts) | Startup validation and `ctx.crewProfilePresets` provider |
| [`cordis.patch.yml`](cordis.patch.yml) | Ordered Host composition over the selected application bundle |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Crew service](../../subagent/crew/README.md) — durable stages, evidence, recovery, and host operations.
- [Crew tools](../../subagent/tool-crew/README.md) — exact manager and worker model tools.
- [Crew Web profile](../crew-web-profile/README.md) — manager-only browser layer.
- [Native Crew development plan](../../../docs/developer/discussion/agent-orchestration-core-development-plan.md) — first-phase product scope and acceptance.

-----

<a id="model-experience"></a>
## Model Experience

### Crew role composition

#### What the model sees

The root model keeps its selected persona and ordinary tools alongside Crew coordination policy, logged DSH-global memory, and `crew_*` manager schemas. The policy states Crew mechanics and names when to engage a Crew; the selected preset decides which case applies, so a session on `crew-manager` reads a persona mandating orchestration while an ordinary preset keeps the discretion. Each child receives its role persona, durable assignment, and role tools. Actionable Crew notifications enter the manager as durable user messages after its current turn ends.

#### Token effect

The manager pays one fixed persona and policy cost plus its manager schemas. Each worker pays its role persona, delegated-agent safety text, role schemas, and one variable assignment; later tool results and repair prompts append to that worker's history.

#### KV Cache effect

The manager and worker prefixes remain stable while the profile, role preset, and selected model route remain unchanged. Work assignments, evidence, and notifications append after those prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Pre-stable API** — profile and role declarations can change with the matching consumers.
- **Shared checkout** — role isolation uses mutually exclusive repository scopes and host verification; this profile does not create worktrees.
- **Native workers only** — external CLI providers, their login state, and quota presentation are outside this layer.
- **Local commit only** — `crew_commit` requires an approval decision and never pushes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep role declarations synchronized with `CREW_ROLE_TOOL_NAMES`; profile activation deliberately rejects drift instead of silently weakening a role.

</details>

**Runtime invariant:** No invariant companion is published because this static composition package owns only validated profile inputs. The Team and Crew packages own the independently observable runtime relationships.
