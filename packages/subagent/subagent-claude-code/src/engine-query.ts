/** Official SDK queries whose native CLI process belongs to DSH subprocess ownership. */

import { query, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from './process.ts'
import { disposeClaudeCodeChild } from './run.ts'

/** One SDK operation with an explicit process-range release operation. */
export interface ManagedClaudeQuery {
  readonly query: Query
  /** Actual native binary chosen by the SDK, shared with account commands. */
  readonly executable: string
  /** Close protocol transport and await whole-range quiescence. */
  close(): Promise<void>
}

/**
 * Start an official query while retaining ownership even when construction fails.
 * @param prompt - caller-owned input stream or a single prompt.
 * @param options - fully resolved SDK options excluding process ownership.
 * @param spawn - scoped DSH subprocess owner.
 * @param graceMs - configured whole-range termination grace.
 * @returns query and idempotent teardown after the real child has been captured.
 */
export async function openManagedClaudeQuery(
  prompt: string | AsyncIterable<SDKUserMessage>,
  options: Omit<Options, 'spawnClaudeCodeProcess'>,
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  graceMs: number,
): Promise<ManagedClaudeQuery> {
  let child: SubprocessHandle | undefined
  let executable: string | undefined
  let instance: Query | undefined
  try {
    instance = query({ prompt, options: {
      ...options,
      spawnClaudeCodeProcess: (launch) => {
        executable = launch.command
        child = spawn(claudeSpawnSpec(launch, graceMs))
        return new ManagedClaudeCodeProcess(child)
      },
    } })
    if (child === undefined || executable === undefined) throw new Error('Claude SDK did not start its native process')
    const ownedChild = child
    const ownedQuery = instance
    let closing: Promise<void> | undefined
    return {
      query: ownedQuery, executable,
      close: () => closing ??= disposeClaudeCodeChild(ownedQuery, ownedChild),
    }
  } catch (error) {
    if (child !== undefined) await disposeClaudeCodeChild(instance, child)
    else instance?.close()
    throw error
  }
}
