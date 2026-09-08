# Agent Note: Windows and Linux desktop shell and installer runtime

Status: implemented

English | [中文](2026-08-24-cross-platform-desktop-shell.zh.md)

## Problem

Desktop development can reuse a built checkout, while distribution must carry its own Node.js, package manager, and dependency graph. Copying a complete runtime into every development build is costly; depending on a developer's checkout makes an installer unusable elsewhere.

## Decision

The Electron shell reuses the Web application and its plugin composition. The [upstream integration decision](../architecture/2026-09-08-upstream-desktop-crew-integration.md) owns its private Desktop Host and compatibility with Crew. The [packaging architecture](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) owns the isolated profile, offline seed, and bundled runtime.

Development uses the built workspace through a disposable linked desktop project. Packaged applications install an exact release into their own profile using bundled Node.js and pnpm. The [desktop README](../../../../apps/desktop/README.md) owns launch and package commands.

Windows is the primary acceptance platform and Linux is secondary. Linux x64 target selection is retained; native installation and runtime qualification follow the [maintenance scope](../process/2026-09-05-windows-linux-maintenance-scope.md). Retained macOS source and helpers carry no downstream native-test or release commitment.

The shell preserves context isolation, Chromium sandboxing, and disabled Node integration in renderers. The [durable exit protocol](2026-09-05-windows-tray-durable-exit.md) separates hiding from stopping tasks and saving history.

## Alternatives considered

- **Fork the Web UI.** Two presentation implementations would make settings, profiles, and plugin slots drift.
- **Run the backend inside Electron's Node process.** Native window lifetime, backend subprocesses, and plugin dependencies would share one failure domain.
- **Copy the full runtime into every development build.** The built checkout already owns that dependency graph; packaging remains an explicit step.
- **Publish an unverified platform.** A generated installer does not establish native startup, shutdown, or plugin-install behavior.

## Consequences

The development shell requires the checkout; installers require their complete bundled runtime. Platform qualification must match the current packaging implementation. Historical artifacts do not establish that a newly merged runtime installs or starts correctly.
