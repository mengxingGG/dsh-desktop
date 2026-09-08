---
description: "The experimental group map: private prototypes and internal-only plugins excluded from official releases, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/experimental

English | [中文](README.zh.md)

## Summary

The experimental group contains prototype capabilities that are not part of any official release: they run on the real harness, but their contracts can change and they carry no support promise. The group holds the direct-to-model Agent Teams surface and its profile layers, the cross-realm Inspector, the CPython subprocess backend for the code-execution seam, and the browser-worker runtime and image packer used by preview deployments. Use these packages to try an unreleased capability; they carry no stability promise, and released products must not depend on them.

The Team domain itself and the DSH-native software Crew are no longer here: they were promoted to their product-role groups by the [Crew delivery decision](../../.agents/notes/implemented/feature/2026-09-06-native-crew-default-delivery.md), which is also where the reason the packages below stayed behind is recorded.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.md) | Explicit source-checkout profile layer for Agent Teams | — |
| [`agent-team-web-profile`](agent-team-web-profile/README.md) | Explicit source-checkout Web layer for Agent Teams | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.md) | Team roster, task board, and teammate navigation for Web | — |
| [`code-runtime-python`](code-runtime-python/README.md) | CPython subprocess backend for the code-execution seam | `ctx.codeRuntime` |
| [`inspector`](inspector/README.md) | Cross-realm CDP hub for Host debugging, Client Runtime inspection, network capture, and Cordis trees | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.md) | Nine tools that let the model create, message, and coordinate teammates | registers scoped tools on `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.md) | Builds the gzip-compressed VFS image consumed by the browser worker preview | library and CLI — no ctx key |
| [`webworker-runtime`](webworker-runtime/README.md) | Runs the harness plugin tree inside a dedicated browser worker | library and worker entry — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Experimental package decision](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — placement, release exclusion, and dependency isolation.
- [Crew delivery decision](../../.agents/notes/implemented/feature/2026-09-06-native-crew-default-delivery.md) — which packages were promoted out of this group, and why these stayed.
- [Agent Teams subsystem](../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [Experimental subtree rules](AGENTS.md) — what experimental status does and does not relax.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
