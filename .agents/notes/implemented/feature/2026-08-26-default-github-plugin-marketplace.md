# Agent Note: Default GitHub plugin marketplace

Status: implemented

English | [中文](2026-08-26-default-github-plugin-marketplace.zh.md)

## Problem

Public dsh bundles are installable through the CLI, but repository discovery, manifest recognition, and the installation command require prior knowledge. A desktop window does not provide a terminal as its primary interface, and a marketplace implemented inside Electron would make plugin behavior depend on the presentation host instead of the Web profile.

Search results also cross a trust boundary. A public GitHub repository may be unrelated, malformed, abandoned, or malicious; popularity and a topic label do not establish that it is a dsh bundle or that its installation scripts are safe.

## Decision

The standard Web bundle mounts the marketplace by default as two ordinary Cordis plugins. `@deepseek-ai/dsh-host-plugin-marketplace-github` owns GitHub access, manifest validation, profile mutation, timeout, cancellation, and the `pluginMarketplace` Typert Remote. `@deepseek-ai/dsh-client-ui-settings-plugin-marketplace` contributes the localized Settings tab, search guidance, repository cards, details, source links, explicit confirmation, and installation status. [`@deepseek-ai/dsh-api-remotes`](../../../../packages/api/remotes/README.md) is the only Host-to-Client assembly point.

Keyword and blank searches require the configurable `dsh-plugin` topic. Exact `owner/repository` values and repository URLs bypass topic discovery but retain every repository and manifest check. A result must be public, non-archived, and backed by a root `package.json` with a valid npm package name and `dsh.bundle.patch`; the Host omits all other repositories before the browser receives them.

Installation is a distinct reviewed action, not a side effect of search or card expansion. The Client warns that third-party package scripts run with the local account's permissions and requires confirmation naming the selected repository and package. The Host revalidates the repository, serializes installations, invokes the ordinary profile plugin command as a hidden process, bounds diagnostic output, scrubs inherited secret-bearing variables, and cancels the process tree when its service unloads. The installed bundle becomes active after the profile restarts.

The GitHub token remains a Host launch-environment concern selected by the `tokenEnv` configuration; it never crosses the Remote. The default works without a token under GitHub's unauthenticated rate limit. Because both halves are normal Web bundle rows, an overlay can disable or replace either one, and the same marketplace serves browser and desktop launches without an Electron API.

## Alternatives considered

**Put the marketplace in Electron.** Rejected because browser-only launches would lose it and plugin installation would gain a second desktop-specific implementation. Keeping Electron limited to window and backend lifecycle preserves the [desktop shell decision](2026-08-24-cross-platform-desktop-shell.md).

**Keep the marketplace only in an external repository.** Rejected for this distribution because users would need the CLI installation workflow before they could discover the UI that simplifies that workflow. The packages remain ordinary plugins, so upstream-oriented or minimal deployments can omit them.

**Show arbitrary GitHub search results.** Rejected because topic matches alone include repositories that the dsh loader cannot use. Host-side repository and manifest validation keeps invalid entries out of the trusted Client method result.

**Install immediately from a result card.** Rejected because source metadata and an explicit trust decision must precede execution of third-party install scripts. Details and installation remain separate controls.

## Testing

Host tests cover keyword discovery, exact repository lookup, manifest filtering, token selection, installation arguments, secret scrubbing, output bounds, timeout, cancellation, and Remote registration. Client tests cover localized cards, search guidance, detail expansion, confirmation, success and failure states, late slot declaration, redeclaration, locale changes, and teardown. The assembled Web profile and desktop runtime use the same Remote names and Cordis rows.

## Consequences

Web and desktop users can discover compatible public repositories and start installation without copying a CLI command. Search cards provide enough source metadata for a deliberate review, while the standard profile and package manager remain the only installation mechanism.

Discovery depends on GitHub availability and rate limits. Structural validation and confirmation do not make third-party code safe, curated, signed, maintained, or compatible. Activation requires a restart, and update, removal, private-repository access, permissions, signatures, installed-state reconciliation, and dependency-conflict reporting remain separate work.
