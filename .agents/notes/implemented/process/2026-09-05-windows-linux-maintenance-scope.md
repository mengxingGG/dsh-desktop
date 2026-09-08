# Agent Note: Windows and Linux maintenance scope

Status: implemented

English | [中文](2026-09-05-windows-linux-maintenance-scope.zh.md)

## Problem

The maintainer has Windows hardware but no Mac. Active macOS development and native release validation consume time without a local device on which to reproduce user failures. Hosted build success cannot replace that maintenance capability.

## Decision

Windows is the primary development and acceptance platform; Linux is secondary. macOS has no active development, native testing, compatibility work, or release commitment. Existing compatibility code, local build helpers, and historical artifacts remain intact. Reproducible macOS issues and contributor fixes can be considered without making that platform a prerequisite for Windows or Linux work.

The current [Crew development phase](../../../../docs/developer/discussion/agent-orchestration-core-development-plan.md) is accepted on native Windows. Local Linux/WSL environment recovery, full replay, and compatibility fixes are deferred and do not block that phase. Windows still requires complete functional and security evidence, including its native subprocess path. This prioritization neither disables existing Linux CI nor establishes Linux correctness; Linux validation resumes only when explicitly placed in scope on a suitable host.

GitHub Actions and GitLab CI select only Windows x64 and Linux x64/arm64 runtime builds. The Python release set contains those three runtime wheels and one pure SDK wheel. The reusable workflow rejects other target inputs. The macOS serial reference, Seatbelt CI leg, and Landlock macOS fallback job are absent; their underlying source implementations are retained. No hosted workflow or publication is launched by this local configuration change.

This decision replaces only the platform commitments in the [serial CI reference](2026-07-21-serial-cross-platform-ci-reference.md), [installed-wheel validation](../testing/2026-08-23-installed-python-wheel-black-box-ci.md), and [single-file runtime distribution](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md). Those records remain active for independent validation, installed-artifact provenance, and packaging semantics. The [desktop distribution](../feature/2026-08-24-cross-platform-desktop-shell.md) retains its Windows/Linux-only scope.

## Alternatives considered

**Continue macOS work using hosted runners alone.** Rejected because the maintainer cannot investigate native failures on a local device and has explicitly chosen to spend that time on Windows and Linux.

**Delete every macOS implementation.** Rejected because removing working compatibility code would create avoidable churn and prevent users from supplying focused fixes. Stopping maintenance does not require deliberately breaking existing behavior.

**Require local Linux replay before Windows acceptance.** Rejected because the current development scope prioritizes Windows, and Linux execution does not verify Windows behavior. Platform-specific failures remain recorded for later native investigation.

## Consequences

Maintained releases do not promise macOS compatibility or publish new macOS Python runtime wheels. Existing source may work there, but this is not verified by the maintained CI matrix. Contributor reports need a concrete reproduction; restoring proactive maintenance requires an explicit scope decision and a native verification owner.

The workflow regression checks reject macOS runner selection, pin the three accepted runtime targets, and require matching GitHub/GitLab publication contents. Those CI requirements remain in force; they do not make local Linux/WSL work a prerequisite for the current Windows-first Crew phase.
