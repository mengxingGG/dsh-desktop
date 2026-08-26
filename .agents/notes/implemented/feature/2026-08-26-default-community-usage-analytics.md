# Agent Note: Default community usage analytics

Status: implemented

English | [中文](2026-08-26-default-community-usage-analytics.zh.md)

## Problem

The Web and desktop surfaces need a low-friction view of provider balances, subscription quotas, token totals, cache effectiveness, and daily activity. Requiring a separate marketplace installation makes basic local usage visibility unavailable on first launch and creates another setup step before a user can judge account state or cache behavior.

Usage analytics touches credentials, durable session logs, outbound provider requests, loopback HTTP routes, and persistent local summaries. Making an arbitrary community release part of the default profile without a fixed source and security review would expand the default trust set invisibly.

## Decision

[`@deepseek-ai/dsh-web-app`](../../../../packages/bundle/web-app/README.md) depends on `@ychris12138/dsh-usage-stats` at exact version `0.2.9` and mounts it through the ordinary `usage-stats` Cordis config entry. The same dual Host/Client plugin therefore serves browser, direct desktop, and installed desktop launches. A profile overlay can disable or replace the row without changing Electron or the Web host.

The plugin contributes the **Usage/Balance** sidebar action and panel. It renders the selected provider's balance or subscription windows, today/month/lifetime token totals, cache-hit rate, and a daily heatmap from locally aggregated session usage. Its Host resolves configured provider credentials, returns only normalized account values, and persists fold progress under `DSH_HOME/storages/usage-stats-cache.json`; the cache excludes prompts, responses, tool data, credentials, and file paths.

The dependency remains an external package rather than copied compiled JavaScript. The reviewed npm artifact identifies Git commit [`f91cf9843425616e0730a459c25d4f340e448e47`](https://github.com/Ychris12138/dsh-usage-stats/tree/f91cf9843425616e0730a459c25d4f340e448e47), and `pnpm-lock.yaml` fixes its registry integrity. The package carries the upstream MIT copyright and license, while the repository's generated third-party notices disclose the dependency. Updating the exact version requires a new source, license, behavior, and test review.

## Security and lifecycle

The reviewed release declares no production dependency or install lifecycle script. Account routes accept loopback callers and read-only methods; provider credentials stay on the Host. Built-in adapters target their provider endpoints, while declarative monitors default to HTTPS, same-origin relative paths, manual redirects, bounded JSON responses, DNS validation and address pinning, and private-network denial.

The Host performs an immediate aggregation/account refresh and repeats it every five minutes. An account without a configured credential remains local and reports `not-configured`; a configured account may contact its provider before the panel opens. Disposal clears the timer and waits for an active refresh. The plugin neither registers model-facing input nor changes session events.

## Alternatives considered

**Copy the published JavaScript into this monorepo.** Rejected because the published package is compiled, hand-bundled code that does not satisfy this repository's TypeScript package and Client CSS conventions. Copying it would create a silent fork while losing the upstream release identity, security fixes, and test suite.

**Rewrite a smaller first-party analytics package.** Rejected for this integration because reproducing provider normalization, subscription windows, DNS pinning, restart-safe folding, and browser presentation would duplicate a maintained implementation. A first-party replacement remains appropriate if the external package's APIs or maintenance cease to meet this profile's requirements.

**Leave analytics as an optional marketplace install.** Rejected because balances and cache effectiveness are baseline operational feedback for this distribution. Keeping the implementation as one removable Cordis config entry preserves plugin composition without withholding the default view.

**Track a Git branch or version range.** Rejected because a default dependency must not change its executable code without a reviewed manifest and lockfile change.

## Testing

The pinned upstream release's bundle, Client render, overlay ordering, Host routes, balance adapters, subscription adapters, account security, cache, and installer programs run without failures. The assembled local Web profile returns successful empty usage and provider responses without credentials, creates the aggregate cache, renders the Usage/Balance panel and cache-hit field, and retains the built-in marketplace alongside it. Desktop runtime-closure and installer checks cover the dependency through the Web bundle.

## Consequences

Every default Web or desktop launch includes local usage and account visibility, and self-contained installers carry the exact reviewed package. No additional plugin installation or alternate desktop API is required.

The default profile gains an external executable dependency, a local aggregate cache, and periodic Host work. Configured accounts may make provider requests in the background, and upstream behavior does not inherit this monorepo's static checks. Maintainers must review each version update explicitly or disable the row when that trust or maintenance cost is no longer acceptable.
