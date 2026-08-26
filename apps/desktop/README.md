# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The desktop app is an Electron shell over the existing `dsh web` profile. It owns the native window and backend process lifecycle; the Web application, profiles, settings, and plugin composition remain the same product paths used by the CLI.

## Artifacts

| Mode | Artifact | Runtime contents |
|---|---|---|
| Direct shell | `DeepSeek-Harness.exe` on Windows, `DeepSeek-Harness.AppImage` on Linux, or `DeepSeek-Harness.app` on macOS at the repository root | Electron only. It locates the built checkout and starts its CLI with a compatible system Node.js installation. |
| Installer | NSIS installer on Windows, DMG on macOS, or DEB on Linux under `apps/desktop/dist/installers` | Electron, Node.js, pnpm, the built CLI and Web assets, and the production dependency closure. |

The direct shell is part of the ordinary repository build and is meant for the checkout that produced it. The installer is self-contained and does not require a checkout, Node.js, or pnpm on the destination machine.

## Commands

| Command | Result |
|---|---|
| `pnpm run build` | Build the repository and write the direct shell for the current host to the repository root. |
| `pnpm run desktop` | Run the complete build, then launch the desktop app from the checkout. |
| `pnpm run desktop:dist` | Build the repository and the current host's installer. |
| `pnpm run desktop:dist:win` | Build the Windows NSIS installer on Windows. |
| `pnpm run desktop:dist:mac` | Build the macOS DMG on macOS. |
| `pnpm run desktop:dist:linux` | Build the Linux DEB on Linux. |

Installer builds are host-native. A platform-specific command fails when invoked from another operating system instead of attempting an unsupported cross-build.

## Backend lifecycle

The Electron main process starts `dsh web --no-open --host 127.0.0.1 --port 0` as a hidden child, waits for the emitted loopback URL, and then navigates the window to that origin. The direct shell runs `apps/cli/lib/bin.js` from the built checkout. The installer runs the bundled CLI with the bundled Node.js executable and exposes the bundled pnpm entry to `dsh plugin`.

Closing the application terminates the complete backend process tree and waits for the root child to exit. Startup errors replace the loading view with bounded stdout and stderr diagnostics instead of leaving a foreground terminal or orphan backend.

## Security

The renderer uses context isolation, disables Node integration, and enables the Chromium sandbox. The window denies permission requests, keeps ordinary navigation on the loopback backend origin, and asks before opening HTTP or HTTPS links in the system browser.

## Plugin compatibility

The shell starts the standard Web profile under the standard `DSH_HOME`. Bundles installed through `dsh plugin` therefore use the same profile manifest and loader path in CLI, direct-shell, and installed-desktop runs. The Web profile mounts the default GitHub marketplace and the version-pinned community usage-statistics plugin; Electron defines no separate plugin format, discovery API, installation path, or analytics store.

## Verification

1. From a clean checkout, run `pnpm install` and `pnpm run build`.
2. Double-click the direct artifact at the repository root and confirm the Web application opens without a terminal window.
3. Close the window and confirm no backend process remains.
4. Run the installer command for the host operating system, then install or open the produced package.
5. Confirm the installed application opens the same profile, persists settings under the same `DSH_HOME`, exposes the Usage/Balance panel, and can search for, install, and load an external bundle through the built-in marketplace.

## Model Experience

None, as the desktop shell starts the existing Web profile and registers no model-facing prompt, tool, or event.

#### KV Cache effect

The shell adds no request tokens and does not change cache reuse; the plugins mounted by the selected profile own those effects.

## Known Limitations and Deferred Work

- **Signing is release-owned** — local builds are unsigned unless the release environment supplies platform signing credentials, so operating systems may display an untrusted-publisher warning.
- **The direct shell is not standalone** — moving it away from its built checkout requires `DSH_DESKTOP_PROJECT_ROOT`, and the destination still needs a compatible Node.js installation.
- **Linux packaging is DEB-only** — the repository does not currently produce RPM, Flatpak, or Snap packages.
