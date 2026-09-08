/** Real-path, symbolic-link, and hard-link enforcement for Crew-owned worker file tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { CrewFileEntry, CrewFileRead } from './types.ts'
import { CrewError } from './error.ts'
import { pathInCrewScope, repositoryPath, resolveRepositoryPath } from './validation.ts'

const MAX_TEXT_CHARS = 1_000_000

interface AuthorizedTarget {
  readonly path: string
  readonly target: FsTarget
}

/** Crew-facing repository filesystem whose authorization is recomputed on every operation. */
export class CrewWorkspace {
  /** @param ctx - Crew context with one canonical filesystem provider. */
  constructor(private readonly ctx: Context) {}

  /**
   * Read one authorized regular UTF-8 file.
   * @param repositoryRoot - Absolute authorized repository root.
   * @param path - Candidate repository-relative file path.
   * @param readScopes - Optional worker read-scope allowlist.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and bounded UTF-8 content.
   */
  async read(
    repositoryRoot: string,
    path: string,
    readScopes: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<CrewFileRead> {
    const fs = this.fileSystem()
    const authorized = await this.authorize(repositoryRoot, path, readScopes, signal)
    const info = await fs.stat(authorized.target, signal)
    if (info?.type !== 'file') throw new CrewError(`Crew file "${authorized.path}" is not a regular file`, 'CREW_INVALID_PATH')
    if (info.size !== undefined && info.size > MAX_TEXT_CHARS * 4) {
      throw new CrewError(`Crew file "${authorized.path}" exceeds the read limit`, 'CREW_INVALID_PATH')
    }
    const content = await fs.readText(authorized.target, signal)
    if (content.length > MAX_TEXT_CHARS) throw new CrewError(`Crew file "${authorized.path}" exceeds the read limit`, 'CREW_INVALID_PATH')
    return { path: authorized.path, content }
  }

  /**
   * List one authorized directory without reading child content.
   * @param repositoryRoot - Absolute authorized repository root.
   * @param path - Candidate repository-relative directory path.
   * @param readScopes - Optional worker read-scope allowlist.
   * @param signal - Caller cancellation signal.
   * @returns At most 500 direct directory entries.
   */
  async list(
    repositoryRoot: string,
    path: string,
    readScopes: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<CrewFileEntry[]> {
    const fs = this.fileSystem()
    const authorized = path === '.' && readScopes === undefined
      ? { path: '.', target: await fs.resolve(repositoryRoot, { signal }) }
      : await this.authorize(repositoryRoot, path, readScopes, signal)
    const info = await fs.stat(authorized.target, signal)
    if (info?.type !== 'directory') throw new CrewError(`Crew path "${authorized.path}" is not a directory`, 'CREW_INVALID_PATH')
    const entries = await fs.listDir(authorized.target, signal)
    return entries.filter((entry) => {
      const name = entry.name.toLowerCase()
      return name !== '.git' && name !== '.env' && !name.startsWith('.env.')
    }).slice(0, 500).map(entry => ({ name: entry.name, type: entry.type }))
  }

  /**
   * Atomically create or replace one authorized UTF-8 file with a freshness guard.
   * @param repositoryRoot - Absolute authorized repository root.
   * @param path - Candidate repository-relative file path.
   * @param content - Complete replacement UTF-8 content.
   * @param writeScopes - Optional worker write-scope allowlist.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and whether the file was created or updated.
   */
  async write(
    repositoryRoot: string,
    path: string,
    content: string,
    writeScopes: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<{ path: string; operation: 'create' | 'update' }> {
    const fs = this.fileSystem()
    if (content.length > MAX_TEXT_CHARS) throw new CrewError('Crew write content exceeds the limit', 'CREW_INVALID_PATH')
    const authorized = await this.authorize(repositoryRoot, path, writeScopes, signal)
    const current = await fs.stat(authorized.target, signal)
    if (current !== undefined && current.type !== 'file') {
      throw new CrewError(`Crew path "${authorized.path}" is not a regular file`, 'CREW_INVALID_PATH')
    }
    const outcome = await fs.writeText(
      authorized.target,
      content,
      current === undefined ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: current.version },
      signal,
      { mode: 'workspace-write', workspaceRoot: repositoryRoot },
    )
    return { path: authorized.path, operation: outcome.operation }
  }

  /**
   * Apply one literal, version-guarded edit to an authorized regular file.
   * @param repositoryRoot - Absolute authorized repository root.
   * @param path - Candidate repository-relative file path.
   * @param oldString - Literal text that must exist.
   * @param newString - Literal replacement text.
   * @param replaceAll - Whether every occurrence may be replaced.
   * @param writeScopes - Optional worker write-scope allowlist.
   * @param signal - Caller cancellation signal.
   * @returns Normalized path and confirmed replacement status.
   */
  async edit(
    repositoryRoot: string,
    path: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    writeScopes: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<{ path: string; replaced: true }> {
    const fs = this.fileSystem()
    if (oldString.length === 0) throw new CrewError('Crew edit oldString must not be empty', 'CREW_INVALID_PATH')
    const authorized = await this.authorize(repositoryRoot, path, writeScopes, signal)
    const current = await fs.stat(authorized.target, signal)
    if (current?.type !== 'file') throw new CrewError(`Crew file "${authorized.path}" is not a regular file`, 'CREW_INVALID_PATH')
    await fs.editText(
      authorized.target,
      { oldString, newString, replaceAll },
      { version: current.version },
      signal,
      { mode: 'workspace-write', workspaceRoot: repositoryRoot },
    )
    return { path: authorized.path, replaced: true }
  }

  private async authorize(
    repositoryRoot: string,
    value: string,
    scopes: readonly string[] | undefined,
    signal: AbortSignal,
  ): Promise<AuthorizedTarget> {
    const fs = this.fileSystem()
    const path = repositoryPath(value, 'Crew path')
    if (scopes !== undefined && !scopes.some(scope => pathInCrewScope(path, scope))) {
      throw new CrewError(`Crew worker path "${path}" is outside its assigned scopes`, 'CREW_INVALID_PATH')
    }
    const parts = path.split('/')
    for (let length = 1; length <= parts.length; length += 1) {
      signal.throwIfAborted()
      const prefix = parts.slice(0, length).join('/')
      const info = await fs.lstat(prefix, { cwd: repositoryRoot }, signal)
      if (info?.type === 'symlink') {
        throw new CrewError(`Crew path "${path}" traverses symbolic link "${prefix}"`, 'CREW_INVALID_PATH')
      }
      if (info?.type === 'file' && info.linkCount !== 1) {
        throw new CrewError(`Crew path "${path}" requires a verified hard-link count of one`, 'CREW_INVALID_PATH')
      }
      if (info === undefined) break
    }
    const root = await fs.resolve(repositoryRoot, { signal })
    const target = await fs.resolve(resolveRepositoryPath(repositoryRoot, path, 'Crew path'), { signal })
    if (!fs.contains(root, target)) {
      throw new CrewError(`Crew path "${path}" escapes the repository root`, 'CREW_INVALID_PATH')
    }
    return { path, target }
  }

  private fileSystem() {
    const fs = this.ctx.get('fs')
    if (fs === undefined) throw new CrewError('Crew requires a filesystem provider', 'CREW_INVALID_CONFIG')
    return fs
  }
}
