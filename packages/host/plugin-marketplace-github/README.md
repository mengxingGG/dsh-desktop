# @deepseek-ai/dsh-host-plugin-marketplace-github

English | [中文](README.zh.md)

GitHub discovery and profile installation provider for the Web plugin marketplace. `PluginMarketplaceGateway` registers the `pluginMarketplace` Typert Remote with `search` and `add` methods. [`api-remotes`](../../api/remotes/README.md) mounts the generated Client contribution; the package declares no same-process Client API.

Search accepts a keyword, an exact `owner/repository` identity, or a GitHub repository URL. A blank keyword requests popular repositories carrying the configured topic. Every result is public and non-archived, and its root `package.json` declares a valid npm package name plus `dsh.bundle.patch`; repositories that fail any check are omitted. Results contain the repository identity, package name, description, source URL, default branch, stars, forks, license, and update time used by the browser cards.

Installation re-fetches the selected repository and manifest, then runs the ordinary hidden `dsh plugin --profile <profile> add github:<owner/repository>` path. Only one installation runs at a time. Service disposal cancels an active process tree, and the Remote reports success only after the profile mutation exits successfully. A successful installation requires a profile restart before the new bundle becomes active.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `topic` | `dsh-plugin` | GitHub topic required for keyword and blank searches. |
| `searchMaxResults` | `8` | Maximum validated cards returned per search. |
| `requestTimeoutMs` | `15000` | Timeout for each GitHub request. |
| `installTimeoutMs` | `300000` | Timeout for the plugin installation process. |
| `profile` | `web` | Profile changed by an installation. |
| `tokenEnv` | `GITHUB_TOKEN` | Launch-environment variable containing an optional GitHub token. |

The token is never accepted from the browser. The installer removes inherited environment variables whose names contain `KEY`, `SECRET`, `TOKEN`, or `PASSWORD` before it starts third-party package scripts, while retaining the profile and bundled-package-manager environment required by `dsh plugin`.

## Model Experience

None, as this Host Remote registers no prompt, tool, message, or provider input.

#### KV Cache effect

None; search and installation never assemble model input.

## Known Limitations and Deferred Work

- **GitHub availability and limits apply** — unauthenticated search has GitHub's lower API allowance, and transient GitHub failures prevent discovery and manifest revalidation.
- **Installation executes third-party code** — manifest validation proves dsh bundle structure, not trust, safety, maintenance quality, or compatibility; the browser must obtain explicit user confirmation before invoking `add`.
- **Install only** — the Remote does not activate a bundle without restart and does not provide update, removal, signature verification, curation, or dependency-conflict resolution.
