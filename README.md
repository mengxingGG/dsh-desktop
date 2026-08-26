# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Downstream maintenance

This repository is maintained as a community downstream distribution based on DeepSeek Harness, not as an official DeepSeek release. Downstream changes remain MIT-licensed; retain the upstream copyright, license, and third-party notices.

1. After creating the personal fork, use `upstream` for `deepseek-ai/deepseek-harness` and `origin` for the downstream repository.
2. At least once a week, fetch official `master` and tags, then review new commits, releases, security fixes, and compatibility-breaking changes.
3. Integrate applicable upstream changes through a temporary sync branch. Keep downstream features isolated as applications or plugins so conflicts do not require forking the Harness core.
4. Before each downstream release, confirm the official update review is current and rerun dependency installation, checks, the complete build, and desktop runtime verification.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/mengxingGG/dsh-desktop.git
cd dsh-desktop
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

### Desktop application

Source builds also write a direct desktop shell for the current operating system to the repository root: `DeepSeek-Harness.exe` on Windows, `DeepSeek-Harness.AppImage` on Linux, or `DeepSeek-Harness.app` on macOS. The shell starts `dsh web` as a hidden loopback backend and hosts the existing Web application in a native window; it requires the built checkout and a compatible system Node.js installation.

```sh
pnpm run build
pnpm run desktop
```

Self-contained installers include Electron, Node.js, pnpm, the built CLI and Web assets, and the production dependency closure. Build them on the matching host operating system:

```sh
pnpm run desktop:dist:win
pnpm run desktop:dist:mac
pnpm run desktop:dist:linux
```

See the [desktop application reference](apps/desktop/README.md) for artifact paths, lifecycle behavior, security controls, and platform limitations.

### Built-in plugin marketplace

The default Web profile, including the desktop application, provides **Settings → Plugins → Plugin market**. Search by a keyword such as `balance`, `memory`, or `tools`; leave the field blank to browse popular repositories carrying the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic; or paste an exact `owner/repository` value. Results appear as reviewable cards with repository details and an explicit installation action.

The marketplace accepts only public, non-archived GitHub repositories whose root `package.json` declares a valid dsh bundle. Installation runs third-party package scripts with the local user's permissions, so inspect the repository and source before confirming. Restart the current profile after installation. Set `GITHUB_TOKEN` in the launch environment when higher authenticated GitHub API limits are needed.

### Usage and balances

The default Web profile also mounts the MIT-licensed [`@ychris12138/dsh-usage-stats`](https://github.com/Ychris12138/dsh-usage-stats) community plugin. Open **Usage/Balance** in the sidebar to view provider balances or subscription quotas, today/month/lifetime token totals, the current month's daily heatmap, and the cache-hit rate. Browser and desktop launches use the same panel and local data.

Provider credentials remain on the Host and never enter browser responses. The plugin stores aggregated token counts, session identifiers, opaque revisions, and fold cursors under `DSH_HOME/storages/usage-stats-cache.json`; it does not store prompts, responses, or file paths. See the upstream repository for supported providers, configuration, and its MIT license.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
