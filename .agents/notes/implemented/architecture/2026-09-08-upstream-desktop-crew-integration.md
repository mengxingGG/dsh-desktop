# Agent Note: Crew and desktop integration with the upstream runtime

Status: implemented

English | [中文](2026-09-08-upstream-desktop-crew-integration.zh.md)

## Problem

The desktop Host, Session persistence API, continuable Subagent implementation, and right sidebar evolve independently of the downstream Crew workflow. A textual merge cannot establish that worker provenance, durable notifications, task shutdown, or community plugins still operate through the shipped composition.

## Decision

The [official desktop architecture](2026-08-25-electron-desktop-packaging-and-updates.md) owns the isolated desktop profile and private Fetch carrier. Desktop installs the same Crew Host and Client bundles as the default Web profile. The [Crew Client](../../../../packages/client/ui-crew/README.md) registers a Session-owned right-sidebar tab; the tab retains worker selection and uses the existing read-only worker observer. Desktop preserves the bundle-composed Agent roots so the shipped `crew-manager` remains selectable alongside built-in and custom presets. The shell does not replace that roster with a separate preset directory.

Continuable workers retain the Crew-owned initial message source and settlement-notice veto across the upstream Subagent implementation split. Crew notification delivery acknowledges a flushed inbox insertion; observing the resulting model message additionally requires the agent to consume that insertion. Session reads use the official handle result and release each read handle.

The [durable exit protocol](../feature/2026-09-05-windows-tray-durable-exit.md) remains authoritative for task preparation and persistence. Shell exit, plugin activation, and updates cannot silently discard active tasks. Normal exit prepares and flushes before terminating the process tree. Restart operations reject active work and leave its Host running.

The pinned community usage plugin has a [pnpm patch](../../../../apps/desktop/patches/@ychris12138__dsh-usage-stats@0.2.9.patch) for the official Session snapshot/handle APIs and trusted Fetch routing. Browser HTTP requests retain the plugin's socket-based loopback checks. Only the private Fetch adapter can mark an already authenticated request; request headers cannot supply that marker. A cache-version change prevents mixing old cursor semantics with zero-based event offsets. Sandboxed preload entry points are bundled independently because Electron cannot resolve local shared chunks there. The current Cordis client configuration evaluator requires dynamic JavaScript evaluation; strict script CSP qualification remains separate work.

The [desktop distribution record](../feature/2026-08-24-cross-platform-desktop-shell.md), durable-exit record, and [Crew delivery record](../feature/2026-09-06-native-crew-default-delivery.md) retain their independent rationale. The [maintenance scope](../process/2026-09-05-windows-linux-maintenance-scope.md) still makes native Windows the acceptance platform for this Crew phase; retained Linux and macOS helpers are not evidence of native qualification.

## Alternatives considered

- **Replace downstream behavior with upstream files wholesale.** This loses manager provenance, Crew delivery, and the task-saving exit protocol.
- **Keep a second desktop backend.** Two runtime owners would disagree on profiles, package installation, and client assets.
- **Open an HTTP port only for usage statistics.** The private carrier already provides authenticated requests; a second listener adds a separate exposure and lifecycle obligation.

## Consequences

Compatibility evidence includes the built Desktop Host with idle and active tasks, usage requests over private pipes, preserved Session logs, focused Crew workflows, sidebar registrations, and package/documentation checks. The dependency patch is version-bound and must be reviewed or retired when the usage plugin adopts these APIs. Native release signing and installer qualification remain separate release work.
