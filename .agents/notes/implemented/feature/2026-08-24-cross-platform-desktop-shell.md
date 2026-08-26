# Agent Note: Cross-platform desktop shell and installer runtime

Status: implemented

English | [中文](2026-08-24-cross-platform-desktop-shell.zh.md)

## Problem

The Web profile is a complete product interface, but using it locally requires a terminal command and an external browser. A desktop distribution needs to replace those two entry steps without creating a second application, changing profile behavior, or keeping `dsh` in a foreground console.

One artifact cannot satisfy both checkout development and end-user distribution efficiently. A checkout already has the built CLI, Web assets, and production dependencies; copying them into every ordinary build makes that path slow and large. An installer must make the opposite guarantee: it cannot depend on a source checkout, a system Node.js installation, or a separately installed package manager.

## Decision

`apps/desktop` is an Electron host for the existing Web profile. Its main process owns one sandboxed browser window and one hidden child process running `dsh web --no-open --host 127.0.0.1 --port 0`. The shell waits for the loopback URL that the Web bundle emits after startup, navigates only after that readiness signal, captures bounded diagnostics, and terminates the complete child process tree before application shutdown completes.

The ordinary `pnpm run build` produces a current-host direct artifact at the repository root. This artifact contains Electron but not the dsh runtime. It locates the built checkout, selects a compatible system Node.js executable, and starts `apps/cli/lib/bin.js`; double-clicking replaces both the CLI startup command and the external browser while keeping the checkout as the source of executable product code.

The `desktop:dist`, `desktop:dist:win`, `desktop:dist:mac`, and `desktop:dist:linux` commands produce self-contained installers on the matching host operating system. Before electron-builder runs, `apps/desktop/runtime/package.json` deploys the CLI's production dependency graph plus every required workspace peer into a hoisted dependency tree, and staging adds the build host's Node.js executable, the pinned pnpm package, and the matching Node.js license. A portability check rejects any dependency link whose resolved target leaves the deployed runtime. The packaged shell selects this bundled runtime before attempting checkout discovery.

The CLI plugin command accepts a JavaScript pnpm entry supplied through `npm_execpath` and otherwise keeps its PATH-based `pnpm` behavior. An installed desktop application can therefore manage profile bundles with its bundled package manager without changing the profile manifest or plugin format.

The renderer enables context isolation and the Chromium sandbox, disables Node integration, rejects permission requests, and prevents ordinary navigation away from the backend origin. HTTP and HTTPS links require confirmation before the system browser opens them. The desktop app registers no model-facing or plugin-facing API; external functionality continues to use ordinary dsh bundles.

## Alternatives considered

**Fork the Web application into a desktop UI.** Rejected because it creates two presentation implementations and makes settings, profiles, plugin slots, and future Web behavior drift. A native host around the assembled Web profile preserves one product interface.

**Run the backend inside Electron's Node process.** Rejected because the native window lifecycle, dsh process tree, native dependencies, and profile-installed packages would share one failure and packaging domain. A plain-Node child preserves the CLI runtime assumptions and gives shutdown one explicit process-tree owner.

**Start the checkout through pnpm instead of the built CLI.** Rejected because a direct artifact would still require pnpm and would treat a package-manager implementation entrypoint as a product runtime API. The direct shell requires the public built CLI and only a compatible Node.js executable.

**Make every ordinary build self-contained.** Rejected because it duplicates the checkout's runtime closure and Node.js on the development path. Separate direct and installer artifacts keep the ordinary build convenient while retaining a distributable package.

**Implement plugin discovery and installation inside the Electron host.** Rejected because those operations are ordinary Web-profile bundle functionality. The [default plugin marketplace](2026-08-26-default-github-plugin-marketplace.md) follows the same Host Remote, Client slot, profile manifest, and installation path as other plugins, while Electron remains a generic lifecycle host.

## Testing

Unit tests pin loopback URL parsing, bounded logs, startup failure diagnostics, cancellation, process-tree shutdown, and rejection of dependency links that leave installer staging. A runtime-closure test requires every required workspace peer in the CLI dependency graph to remain reachable from the private deploy root.

The built runtime starts its bundled CLI with its bundled Node.js executable and serves the Web boot manifest over a random loopback port. With the build staging directory absent, the Windows `win-unpacked` application has no dependency links, starts the hidden bundled backend, returns HTTP 200, and releases the complete Electron and backend process tree after its main window closes. The ordinary Windows build produces the repository-root direct executable, and the installer path produces an NSIS executable and block map. macOS DMG and Linux DEB execution remain host-platform verification responsibilities.

## Consequences

Users can open the local Web product as a desktop application without a foreground terminal. Checkout users receive a small runtime shell through the existing build command, while installer users receive Node.js, pnpm, dsh, and Web assets in one platform package.

The direct artifact is intentionally coupled to the checkout that built it and still requires compatible system Node.js. Installers are larger, must be built on their target operating system, and remain unsigned unless the release environment supplies signing credentials. The private runtime manifest is a maintained list of required workspace peers; its closure test fails when a new production package introduces another one.
