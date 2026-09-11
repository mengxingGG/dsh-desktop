---
description: "Show native Crew workers, live records, and role settings beside ordinary DSH Web conversations."
kind: "package-bundle"
---

# @deepseek-ai/dsh-crew-web-profile

English | [中文](README.zh.md)

## Summary

`dsh-crew-web-profile` adds the Crew workspace, global role settings, and the Crew orchestration Agent preset to the default Web profile. It follows `@deepseek-ai/dsh-web-app` and [`@deepseek-ai/dsh-crew-profile`](../crew-profile/README.md), leaving every ordinary and user Agent preset selectable and the deployment default unchanged. Worker records stream into the read-only right column while the manager conversation remains selected.

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

The default Web profile includes both Crew layers. Custom Web profiles can add them in order:

```sh
pnpm dsh plugin --profile web add ./packages/bundle/crew-profile
pnpm dsh plugin --profile web add ./packages/bundle/crew-web-profile
pnpm dsh web --profile web
```

The Host layer supplies Crew state, Remote methods, role presets, and model tools. This Web layer adds the Client Crew plugin and one roster root. Conversation, tool details, approval, and Session UI remain owned by the Web application bundle.

### The Crew orchestration preset

The roster includes **Orchestration mode** (`crew-manager`), a read-only `system` preset supplied by the Host layer. Its lead retains coding tools, delegates broad responsibilities, and can take over repair, review, and integration.

The deployment default stays `standard`, so the choice is per session: an ordinary preset keeps its full tool set and decides for itself when Crew coordination is worth it. The four presets shipped inside `dsh-agent-presets` are listed first and remain selectable; a later profile patch that restates this row's `roots` drops the Crew preset from the picker.

The roster row belongs to `dsh-web-app`, so this Web layer is where it is patched. A headless profile that installs only the Host Crew layer has no roster and no preset picker; its manager keeps the discretionary Crew policy.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) inserts `@deepseek-ai/dsh-client-ui-crew` and patches the `agent-presets` row with `ctx.crewProfilePresets.agentPresetRoots`. A patch replaces the targeted row's whole `config`, so the row restates `default: standard` beside the added root. [`src/index.ts`](src/index.ts) is an inert module entry because the ordered patch is the package's runtime content.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Crew Host profile](../crew-profile/README.md) — required native workflow and role composition.
- [Crew browser UI](../../client/ui-crew/README.md) — panel projection, selection, and read-only behavior.
- [Web application bundle](../web-app/README.md) — stable browser composition extended by this layer.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the coordination policy and tools owned by the Host Crew profile; the browser layer contributes no model prompt.

#### KV Cache effect

None beyond the Host Crew policy and selected Agent preset.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Ordered composition** — the base, Web application, Crew Host, and Crew Web layers must remain in that order.
- **The roster row is restated, not merged** — a deployment that changes the default preset or adds its own roots must patch `agent-presets` after this layer and restate every key, including this layer's root.
- **Manager-owned workflow** — worker control remains in the manager conversation.
- **Read-only workers** — the browser exposes evidence, not worker navigation or a child composer.
- **Native providers only** — external CLI adapters are outside this layer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No invariant companion is published because this package owns only static profile composition; the Crew service validates runtime relationships.
