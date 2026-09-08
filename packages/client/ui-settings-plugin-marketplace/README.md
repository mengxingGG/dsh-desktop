---
description: "GitHub plugin marketplace tab for Web Settings, with repository search, third-party install confirmation, and restart-owned activation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugin-marketplace

English | [中文](README.zh.md)

## Summary

GitHub **Plugin market** tab for Web Settings. The browser plugin registers one localized `settings.plugins.tab` contribution with id `marketplace`; the Plugins section owns the navigation entry and tab chrome. Registration uses `ctx.slots.inject()`, so the contribution follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

The tab explains useful searches and offers `balance`, `memory`, and `tools` shortcuts. A search calls `ctx.remote.pluginMarketplace.search()` through [`api-remotes`](../../api/remotes/README.md) and renders validated repositories as responsive cards. Each card exposes source metadata, expands to package, branch, license, and update details, and links to the GitHub repository. Empty, loading, no-match, rate-limit, and failure states remain local to the mounted component.

Installation is a separate card action. Before calling `ctx.remote.pluginMarketplace.add()`, the browser names the package and repository and requires confirmation that third-party package scripts run with the local account's permissions. The successful state tells the user to restart the current dsh profile; the UI does not present an unactivated bundle as active.

Expanded cards use the [shared Web theme's panel elevation](../../../docs/web-styling.md) without a layout border.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only provides browser Settings controls and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **GitHub repositories only** — the tab has no registry, local-directory, or private-repository source and does not curate or endorse search results.
- **Restart completes activation** — installation changes the profile on disk, but the tab does not restart the Host or hot-mount the new bundle.
- **No lifecycle management** — installed-plugin status, updates, removal, signatures, permissions, and compatibility reporting remain outside this tab.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns a browser-only Settings contribution; the Host Remote owns repository validation and installation.
