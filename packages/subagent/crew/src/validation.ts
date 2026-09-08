/** Crew configuration, identifier, path, and command validation helpers. */

import { isAbsolute, relative, resolve, sep } from 'node:path'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { CrewCheckoutSnapshot, CrewCommandSpec } from './types.ts'
import { CrewError } from './error.ts'

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Validate non-empty bounded prose.
 * @param value - Candidate prose.
 * @param field - Field name used in rejection messages.
 * @param maxLength - Maximum accepted character count.
 * @returns Trimmed validated prose.
 */
export function crewText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new CrewError(`${field} must contain 1 through ${maxLength} characters`, 'CREW_INVALID_PATH')
  }
  return normalized
}

/**
 * Validate a lower-kebab-case durable key.
 * @param value - Candidate durable key.
 * @param field - Field name used in rejection messages.
 * @returns The validated key.
 */
export function crewKey(value: string, field: string): string {
  if (!KEY_PATTERN.test(value) || value.length > 64) {
    throw new CrewError(`${field} must be lower-kebab-case and at most 64 characters`, 'CREW_INVALID_PATH')
  }
  return value
}

/**
 * Validate a positive safe integer.
 * @param value - Candidate numeric value.
 * @param field - Field name used in rejection messages.
 * @param code - Crew error code used when validation fails.
 * @returns The validated integer.
 */
export function positiveSafeInteger(value: number, field: string, code: 'CREW_INVALID_CONFIG' | 'CREW_INVALID_COMMAND' = 'CREW_INVALID_CONFIG'): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CrewError(`${field} must be a positive safe integer`, code)
  }
  return value
}

/**
 * Validate a positive whole-millisecond duration that Node can schedule without clamping.
 * @param value - Candidate duration.
 * @param field - Field name used in rejection messages.
 * @param code - Crew error code used when validation fails.
 * @returns Duration within the runtime timer range.
 */
export function crewTimerDuration(value: number, field: string, code: 'CREW_INVALID_CONFIG' | 'CREW_INVALID_COMMAND' = 'CREW_INVALID_CONFIG'): number {
  positiveSafeInteger(value, field, code)
  if (value > MAX_TIMER_DELAY_MS) throw new CrewError(`${field} cannot exceed ${MAX_TIMER_DELAY_MS} ms`, code)
  return value
}

/**
 * Validate a non-negative safe integer.
 * @param value - Candidate numeric value.
 * @param field - Field name used in rejection messages.
 * @returns The validated integer.
 */
export function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CrewError(`${field} must be a non-negative safe integer`, 'CREW_INVALID_CONFIG')
  }
  return value
}

/**
 * Normalize a repository-relative path without following filesystem aliases.
 * Absolute paths, credential files, component escapes, and Win32 filename aliases are rejected.
 * @param value - Candidate repository-relative path.
 * @param field - Field name used in rejection messages.
 * @returns Slash-normalized validated path.
 */
export function repositoryPath(value: string, field: string): string {
  const input = value.replaceAll('\\', '/')
  if (input === '' || input === '.' || input.startsWith('/') || /^[A-Za-z]:\//u.test(input)) {
    throw new CrewError(`${field} must be a non-empty repository-relative path`, 'CREW_INVALID_PATH')
  }
  const parts = input.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..'
    || part.trim() !== part || part.endsWith('.') || /[<>:"|?*]/u.test(part)
    || /~[0-9]/u.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part)
    || part.split('').some(char => char.charCodeAt(0) < 32))) {
    throw new CrewError(`${field} contains an invalid path component`, 'CREW_INVALID_PATH')
  }
  if (parts.some((part) => {
    const name = part.toLowerCase()
    return name === '.git' || name === '.env' || name.startsWith('.env.')
  })) {
    throw new CrewError(`${field} cannot target protected repository metadata`, 'CREW_INVALID_PATH')
  }
  return parts.join('/')
}

/**
 * Resolve a normalized repository-relative path and prove lexical containment.
 * @param repositoryRoot - Absolute authorized repository root.
 * @param value - Candidate repository-relative path.
 * @param field - Field name used in rejection messages.
 * @returns Absolute path contained by the repository root.
 */
export function resolveRepositoryPath(repositoryRoot: string, value: string, field: string): string {
  const normalized = repositoryPath(value, field)
  const root = resolve(repositoryRoot)
  const target = resolve(root, ...normalized.split('/'))
  const fromRoot = relative(root, target)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new CrewError(`${field} escapes the repository root`, 'CREW_INVALID_PATH')
  }
  return target
}

/**
 * Determine whether two normalized repository-relative scopes overlap on path components.
 * @param left - First normalized scope.
 * @param right - Second normalized scope.
 * @returns Whether either scope contains the other.
 */
export function crewScopesOverlap(left: string, right: string): boolean {
  return pathInCrewScope(left, right) || pathInCrewScope(right, left)
}

/**
 * Determine whether one normalized repository-relative path belongs to a normalized scope.
 * @param path - Normalized repository-relative path.
 * @param scope - Normalized repository-relative scope.
 * @returns Whether the path equals or descends from the scope.
 */
export function pathInCrewScope(path: string, scope: string): boolean {
  const candidate = process.platform === 'win32' ? path.toLowerCase() : path
  const root = process.platform === 'win32' ? scope.toLowerCase() : scope
  return candidate === root || candidate.startsWith(`${root}/`)
}

/**
 * Validate and detach one exact command declaration.
 * @param command - Candidate shell-free command declaration.
 * @param allowedPrograms - Executable names authorized by Crew configuration.
 * @returns Detached normalized command declaration.
 */
export function crewCommand(
  command: CrewCommandSpec,
  allowedPrograms: ReadonlySet<string>,
): CrewCommandSpec {
  const id = crewKey(command.id, 'test command id')
  crewTimerDuration(command.timeoutMs, 'test command timeoutMs', 'CREW_INVALID_COMMAND')
  const [program] = command.argv
  if (program === undefined || command.argv.some(item => item.length === 0 || item.includes('\0'))) {
    throw new CrewError('test command argv must contain non-empty strings', 'CREW_INVALID_COMMAND')
  }
  if (!allowedPrograms.has(program)) {
    throw new CrewError(`test command program "${program}" is not allowed`, 'CREW_INVALID_COMMAND')
  }
  const subcommand = command.argv[1]?.toLowerCase()
  if ((program === 'pnpm' || program === 'npm' || program === 'yarn' || program === 'bun')
    && ['add', 'install', 'remove', 'uninstall', 'update', 'upgrade', 'link', 'publish'].includes(subcommand ?? '')) {
    throw new CrewError(`dependency mutation command "${program} ${subcommand}" is not allowed`, 'CREW_INVALID_COMMAND')
  }
  return {
    id,
    argv: structuredClone(command.argv),
    cwd: command.cwd === '.' ? '.' : repositoryPath(command.cwd, 'test command cwd'),
    timeoutMs: command.timeoutMs,
  }
}

/**
 * Validate and detach one host checkout observation before durable publication.
 * @param snapshot - Candidate checkout evidence.
 * @returns Detached normalized checkout evidence.
 */
export function crewCheckout(snapshot: CrewCheckoutSnapshot): CrewCheckoutSnapshot {
  const head = snapshot.head === null ? null : crewText(snapshot.head, 'checkout head', 256)
  const statusDigest = crewText(snapshot.statusDigest, 'checkout statusDigest', 256)
  const branch = snapshot.branch === undefined
    ? undefined
    : crewText(snapshot.branch, 'checkout branch', 256)
  const changedPaths = [...new Set(snapshot.changedPaths.map((value, index) => (
    repositoryPath(value, `checkout changedPaths[${index}]`)
  )))]
  const stagedPaths = [...new Set(snapshot.stagedPaths.map((value, index) => (
    repositoryPath(value, `checkout stagedPaths[${index}]`)
  )))]
  if (head === null && (branch !== undefined || stagedPaths.length > 0)) {
    throw new CrewError('local file evidence cannot contain a Git branch or staged paths', 'CREW_CHECKOUT_DRIFT')
  }
  const changed = new Set(changedPaths)
  if (stagedPaths.some(path => !changed.has(path))) {
    throw new CrewError('checkout staged paths must also appear in changed paths', 'CREW_CHECKOUT_DRIFT')
  }
  const pathDigests = Object.fromEntries(Object.entries(snapshot.pathDigests).map(([value, digest]) => {
    const path = repositoryPath(value, 'checkout pathDigests key')
    if (!changed.has(path)) {
      throw new CrewError(`checkout digest path "${path}" is not changed`, 'CREW_CHECKOUT_DRIFT')
    }
    return [path, crewText(digest, `checkout pathDigests[${path}]`, 256)]
  }))
  if (Object.keys(pathDigests).length !== changedPaths.length) {
    throw new CrewError('checkout must carry one digest for every changed path', 'CREW_CHECKOUT_DRIFT')
  }
  return {
    head,
    ...(branch === undefined ? {} : { branch }),
    statusDigest,
    changedPaths,
    stagedPaths,
    pathDigests,
  }
}
