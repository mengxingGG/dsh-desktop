# Agent Note: Crew local development without Git

Status: implemented

English | [中文](2026-09-08-crew-local-development-without-git.zh.md)

## Problem

Requiring a committed HEAD at dispatch blocks ordinary project directories and leads managers to demand Git initialization even when users request local development.

## Decision

Dispatch, verification, review, and integration accept ordinary directories and unborn Git repositories. File inventories provide content, type, and permission evidence with `head: null`; committed Git observations retain their string HEAD and index evidence. Ordinary directories invoke no Git executable. Neither mode initializes repositories or contacts remotes.

Inventories exclude protected metadata and credentials, record links without traversal, detect collection drift, and compare file digests across stages. Replay accepts both evidence forms and rejects local evidence containing a branch or staged paths. The artifact, scope, declared-test, independent-review, and integration requirements remain enforced.

Commit is optional, separately approved, and limited to existing committed Git repositories. A rejected commit preserves accepted local work. Existing Git failures remain explicit.

This partially supersedes the Git-only assumption in the [native Crew decision](2026-09-04-dsh-native-crew-orchestration.md), which remains active for durable workflow, index checks, ownership, and recovery.

## Alternatives considered

- Automatically initialize Git: rejected because adopting version control belongs to the user.
- Skip verification outside Git: rejected because review and integration still require independently observed changes.
- Require a remote: rejected because local verification and optional commits do not need remote access.

## Verification

Host tests cover ordinary and unborn projects, file changes, cancellation, protected paths, and links. Tool tests cover stale-file rejection and optional commit rejection without losing acceptance. The keyless profile runs two developers, review rejection, same-worker repair, and passing integration without creating `.git`; its Git case retains commit coverage.

## Consequences

Local development can finish without Git. Inventories also read dependencies and generated files, so cost grows with project size; local mode does not apply Git ignore rules. File observations detect drift but do not isolate concurrent host processes. Model-provider and declared-command network needs remain separate from Git.
