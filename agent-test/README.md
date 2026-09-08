# Native Crew real-provider smoke

English | [中文](README.zh.md)

This directory exercises the shipped `crew-native` profile against the real DeepSeek provider without installing or invoking an external agent CLI. The run creates an isolated Git repository under a unique `.run/real-*` directory, asks one native developer to implement a small module, lets the host verify it, starts an independent native reviewer, runs a native integrator, and checks the durable Session events and resulting files.

The runner reads `API_KEY` or `DEEPSEEK_API_KEY` from the repository-root `.env`. Straight or curly surrounding quotes are accepted, and the value is never printed or written to the run directory.

Each run owns its profile dependency directory. Only the Crew bundle entry links to the source checkout; runtime-created fallback links stay inside the run directory and cannot populate the checkout's dependency directory.

Build the source checkout first, then run the smoke from the repository root:

```powershell
pnpm run build
pwsh -NoProfile -File .\agent-test\run-real-smoke.ps1
```

Successful output ends with `CREW_REAL_API_VERIFIED`. `CREW_REAL_API_RUN` prints the new run directory; inspect its `transcript.txt`, `verification.json`, and `sessions/` for the model response, machine-checked summary, and raw Session logs. Runs retain earlier evidence, and timeout failures retain the transcript. The API key and run-specific environment variables are supplied only to the child DSH process.

`-SingleProcessTests` selects Node's `--test-isolation=none` for this small integration test without changing Crew's OS sandbox. Its verification report declares `executionCoverage: single-process-only`; a pass does not establish child-process support or full Windows acceptance.

The unattended smoke stops after a passing integration. It does not synthesize a human approval for `crew_commit`; the keyless delivery-profile end-to-end test owns approved local-commit coverage.

## Execution-isolation probe

`node agent-test/probe-appcontainer.mjs` creates a unique temporary Windows LPAC profile, copies Node into its private fixture, grants only fixture-scoped file access, and removes the profile and fixture after process exit. It uses `registryRead` for Node's Winsock initialization and grants no network capability. The observed result is a successful Node exit, denied credential-canary read, denied adjacent-file write, and denied loopback connection. This is a feasibility probe, not a Crew provider or proof that `crew_run_test` is confined.

The Crew execution regression on Windows Node 24.14 reaches the scoped read/write/network checks but stalls when `execFileSync` creates its child pipes. Microsoft's [AppContainer pipe naming rule](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea#remarks) requires the local namespace. The [libuv development source](https://github.com/libuv/libuv/blob/v1.x/src/win/pipe.c) detects AppContainer and chooses that namespace; source inspection of [Node 26.8.1](https://github.com/nodejs/node/blob/v26.8.1/deps/uv/src/win/pipe.c) still finds the unconditional pipe name. Node 26.8.1 has not been runtime-tested here. Neither a system Node replacement nor a WSL product fallback is authorized by this probe.

## Linux Web verification

These helpers are retained for future platform validation. Linux/WSL investigation and replay are deferred by the current [Windows-first Crew plan](../docs/developer/discussion/agent-orchestration-core-development-plan.md) and are not prerequisites for Windows acceptance. They are not a product fallback for unresolved Windows execution failures.

The WSL helpers create a source copy under a unique `/home/admin1/.cache/dsh-crew-web/run-*` directory without `.env`, existing dependencies, or prior build outputs. They use checksum-verified Node 24.14.0 and the repository's pinned pnpm 11.7.0, restore Git-recorded symlinks in the copy, and install test dependencies there. `prepare-linux-browser-libs.sh` unpacks missing Chromium libraries into that directory without system installation. `run-linux-web.sh` stores each run's log and JSON report in a unique result directory; `--built` runs against its existing build. These helpers are host-specific test preparation, not a product launch path.
