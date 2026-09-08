# Agent Note: HMR browser tests restore compiler outputs and incremental state

Status: implemented

English | [中文](2026-09-05-hmr-test-restores-compiler-state.zh.md)

## Problem

The HMR browser test changes `ui-conversation/src/client/locales.ts`. Its watcher compiles that source to `lib/types` before bundling `lib/client.js`. Restoring only the source and browser bundles leaves the compiler emit and incremental state outside cleanup. A later incremental build can report the project up to date and package the test's `HMR UPDATED` text even though the source has no diff.

## Decision

`apps/web/tests/hmr-live.e2e.ts` snapshots the browser artifacts and the edited package's complete `lib` tree, including type emit and `.tsbuildinfo`. Cleanup stops the owned watcher and Host processes before restoring the source and generated files. It removes files introduced within that captured artifact inventory, restores the original bytes, and verifies the source, artifact paths, artifact bytes, and existing complete-build digest. Cleanup errors fail the test together with any interaction error.

The [client build environment](../../archived/architecture/2026-08-18-client-build-environment.md) still owns public variables and the complete browser-artifact digest. The [keyless browser lane](../testing/2026-07-24-web-gui-browser-e2e-lane.md) still owns replay and browser acceptance. Neither digest validation nor a clean source diff proves that intermediate compiler outputs match the restored source.

## Alternatives considered

**Restore only browser bundles.** A later bundler consumes the un-restored type emit and reintroduces the test text.

**Restore the source while watchers are running.** A compiler write can overlap cleanup and leave a partial restored generation.

**Clean the whole checkout after HMR.** This destroys unrelated generated work and discards incremental state beyond the fixture's edited package.

## Consequences

The fixture preserves the pre-test compiler files without changing production build behavior or generating a replacement complete-build record. Its real browser assertion still requires a visible source update without page reload; cleanup additionally compares the captured files byte for byte. The package-wide capture must follow the source owner if the edit target changes.

The test mutates the shared checkout. It must not overlap another build, watcher, or browser consumer in that checkout; restoring captured bytes does not provide cross-process isolation.
