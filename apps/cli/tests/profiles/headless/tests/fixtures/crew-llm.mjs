/** Deterministic keyless model and approval answerer for the native Crew delivery profile. */

import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

let nextCall = 0

function allCalls(messages) {
  return messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'tool-call')
    : [])
}

function callCount(messages, name) {
  return allCalls(messages).filter(call => call.name === name).length
}

function assistantText(messages) {
  return messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'text').map(block => block.text)
    : []).join('\n')
}

function userText(messages) {
  return messages.flatMap(message => message.role === 'user'
    ? message.content.filter(block => block.type === 'text').map(block => block.text)
    : []).join('\n')
}

function resultPayloads(messages) {
  const names = new Map(allCalls(messages).map(call => [call.id, call.name]))
  return messages.flatMap(message => message.role === 'user'
    ? message.content.flatMap((block) => {
      if (block.type !== 'tool-result') return []
      const text = block.content.filter(item => item.type === 'text').map(item => item.text).join('')
      try {
        return [{ name: names.get(block.toolCallId), value: JSON.parse(text) }]
      } catch {
        return []
      }
    })
    : [])
}

function latestResult(messages, name) {
  return resultPayloads(messages).findLast(result => result.name === name)?.value
}

function toolChunks(specs) {
  const chunks = []
  for (const [index, spec] of specs.entries()) {
    const id = ToolCallId(`crew-fixture-${++nextCall}`)
    const args = JSON.stringify(spec.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: spec.name, argumentsDelta: args },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: spec.name, arguments: args } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function currentManagerTurn(messages) {
  const notification = messages.findLastIndex(message => (
    message.role === 'user' && message.source?.kind === 'crew-notification'
  ))
  return notification < 0 ? messages : messages.slice(notification)
}

function developer(messages, moduleKey) {
  const repair = userText(messages).includes('Reviewer rejected the handoff')
  const reports = callCount(messages, 'crew_report')
  const tests = callCount(messages, 'crew_run_test')
  if (!repair) {
    if (callCount(messages, 'crew_write_file') === 0) {
      return toolChunks([{ name: 'crew_write_file', args: {
        path: `modules/${moduleKey}/index.mjs`,
        content: moduleKey === 'alpha' ? 'export const alpha = 41\n' : 'export const beta = 1\n',
      } }])
    }
    if (tests === 0) return toolChunks([{ name: 'crew_run_test', args: { command_id: `syntax-${moduleKey}` } }])
    if (reports === 0) {
      return toolChunks([{ name: 'crew_report', args: {
        verdict: 'ready',
        summary: `Implemented ${moduleKey} and ran its declared syntax check.`,
        changed_paths: [`modules/${moduleKey}/index.mjs`],
        issues: [],
      } }])
    }
    return textChunks(`${moduleKey} developer handoff complete.`)
  }
  if (callCount(messages, 'crew_edit_file') === 0) {
    return toolChunks([{ name: 'crew_edit_file', args: {
      path: 'modules/beta/index.mjs', old_string: 'beta = 1', new_string: 'beta = 2', replace_all: false,
    } }])
  }
  if (tests < 2) return toolChunks([{ name: 'crew_run_test', args: { command_id: 'syntax-beta' } }])
  if (reports < 2) {
    return toolChunks([{ name: 'crew_report', args: {
      verdict: 'ready',
      summary: 'Repaired beta to satisfy the reviewed interface.',
      changed_paths: ['modules/beta/index.mjs'],
      issues: [],
    } }])
  }
  return textChunks('beta repair handoff complete.')
}

function reviewer(messages, moduleKey) {
  if (callCount(messages, 'crew_read_file') === 0) {
    return toolChunks([{ name: 'crew_read_file', args: { path: `modules/${moduleKey}/index.mjs` } }])
  }
  if (callCount(messages, 'crew_report') === 0) {
    const verificationId = /Review host verification ([^;]+);/u.exec(userText(messages))?.[1]
    if (verificationId === undefined) throw new Error('Crew fixture reviewer received no verification id')
    const source = latestResult(messages, 'crew_read_file')?.content ?? ''
    const rejected = moduleKey === 'beta' && source.includes('beta = 1')
    return toolChunks([{ name: 'crew_report', args: rejected ? {
      verdict: 'rejected',
      summary: 'Beta does not satisfy the shared interface.',
      changed_paths: [],
      issues: [{
        path: 'modules/beta/index.mjs',
        line: 1,
        message: 'Beta exports 1.',
        expected: 'Beta must export 2 so the combined result is 43.',
      }],
      verification_id: verificationId,
    } : {
      verdict: 'passed',
      summary: `${moduleKey} matches its frozen specification.`,
      changed_paths: [],
      issues: [],
      verification_id: verificationId,
    } }])
  }
  return textChunks(`${moduleKey} review complete.`)
}

function integrator(messages) {
  if (callCount(messages, 'crew_read_file') === 0) {
    return toolChunks([
      { name: 'crew_read_file', args: { path: 'modules/alpha/index.mjs' } },
      { name: 'crew_read_file', args: { path: 'modules/beta/index.mjs' } },
    ])
  }
  if (callCount(messages, 'crew_report') === 0) {
    return toolChunks([{ name: 'crew_report', args: {
      verdict: 'passed',
      summary: 'Alpha and repaired beta satisfy the shared interface.',
      changed_paths: [],
      issues: [],
    } }])
  }
  return textChunks('integration review complete.')
}

function manager(messages) {
  const text = assistantText(messages)
  if (callCount(messages, 'crew_write_file') === 0) {
    return toolChunks([
      { name: 'crew_write_file', args: {
        path: 'specs/alpha-v1.md',
        content: '# Alpha v1\n\nExport `alpha` with the numeric value 41.\n',
      } },
      { name: 'crew_write_file', args: {
        path: 'specs/beta-v1.md',
        content: '# Beta v1\n\nExport `beta` with the numeric value 2.\n',
      } },
    ])
  }
  const dispatched = callCount(messages, 'crew_dispatch')
  if (dispatched === 0) {
    return toolChunks([{ name: 'crew_dispatch', args: {
      module_key: 'alpha',
      subject: 'Implement alpha',
      description: 'Implement the alpha side of the frozen shared arithmetic interface.',
      spec_path: 'specs/alpha-v1.md',
      spec_revision: 1,
      read_scopes: ['specs', 'shared', 'modules/alpha'],
      write_scopes: ['modules/alpha'],
      required_artifacts: ['modules/alpha/index.mjs'],
      test_commands: [{ id: 'syntax-alpha', argv: ['node', '--check', 'index.mjs'], cwd: 'modules/alpha', timeout_ms: 10000 }],
    } }])
  }
  if (dispatched === 1) {
    return toolChunks([{ name: 'crew_dispatch', args: {
      module_key: 'beta',
      subject: 'Implement beta',
      description: 'Implement the beta side of the frozen shared arithmetic interface.',
      spec_path: 'specs/beta-v1.md',
      spec_revision: 1,
      read_scopes: ['specs', 'shared', 'modules/beta'],
      write_scopes: ['modules/beta'],
      required_artifacts: ['modules/beta/index.mjs'],
      test_commands: [{ id: 'syntax-beta', argv: ['node', '--check', 'index.mjs'], cwd: 'modules/beta', timeout_ms: 10000 }],
    } }])
  }
  if (text.includes('CREW_NATIVE_WORKFLOW_OK')) {
    return textChunks('CREW_NATIVE_WORKFLOW_OK: the durable Crew notification was delivered after the completed native workflow.')
  }
  const turn = currentManagerTurn(messages)
  const notified = turn.some(message => message.role === 'user' && message.source?.kind === 'crew-notification')
  const waits = callCount(turn, 'crew_wait')
  const statuses = resultPayloads(turn).filter(result => result.name === 'crew_status')
  if (!notified && waits === 0) {
    return toolChunks([{ name: 'crew_wait', args: { timeout_ms: 120000, until: 'manager-action' } }])
  }
  const wait = latestResult(turn, 'crew_wait')
  if (wait?.timedOut === true || wait?.noProgress !== undefined) {
    throw new Error(`Crew fixture could not reach manager action: ${JSON.stringify(wait)}`)
  }
  if (statuses.length < waits || statuses.length === 0) return toolChunks([{ name: 'crew_status', args: {} }])
  const status = statuses.at(-1).value

  const ready = status.work_items?.length === 2
    && status.work_items.every(item => item.stage === 'integration_ready')
  const passed = status.integrations?.some(item => item.status === 'passed') === true
  if (!ready && !passed) return textChunks('Crew progress recorded; waiting for the next durable notification.')
  if (passed && userText(messages).includes('Develop locally without Git or a commit.')) {
    return textChunks('CREW_NATIVE_WORKFLOW_OK: local files, independent review, same-worker repair, and integration completed without Git or a commit.')
  }
  if (passed && callCount(turn, 'crew_commit') === 0) {
    const integration = status.integrations.find(item => item.status === 'passed')
    return toolChunks([{ name: 'crew_commit', args: {
      integration_id: integration.integration_id,
      message: 'feat: verify native Crew workflow',
    } }])
  }
  const commit = latestResult(turn, 'crew_commit')
  if (commit !== undefined) {
    if (commit.status !== 'committed') throw new Error(`Crew fixture commit failed: ${JSON.stringify(commit)}`)
    return textChunks('CREW_NATIVE_WORKFLOW_OK: two modules, one rejected review, same-worker repair, integration, and approved local commit completed.')
  }
  if (callCount(turn, 'crew_integrate') === 0) {
    return toolChunks([{ name: 'crew_integrate', args: {
      task_ids: status.work_items.map(item => item.task_id),
      test_commands: [{ id: 'combined', argv: ['node', '--test', 'integration.test.mjs'], cwd: 'tests', timeout_ms: 10000 }],
    } }])
  }
  if (waits < 2) {
    return toolChunks([{ name: 'crew_wait', args: { timeout_ms: 120000, until: 'manager-action' } }])
  }
  return textChunks('Crew integration is running; waiting for its durable notification.')
}

class CrewFixtureAdapter extends LlmAdapter {
  async * stream(options) {
    const input = userText(options.messages)
    let chunks
    if (input.includes('Implement Crew work item')) {
      const moduleKey = /for module ([a-z-]+)\./u.exec(input)?.[1]
      chunks = developer(options.messages, moduleKey)
    } else if (input.includes('Review Crew work item')) {
      const moduleKey = /for module ([a-z-]+)\./u.exec(input)?.[1]
      chunks = reviewer(options.messages, moduleKey)
    } else if (input.includes('Inspect Crew integration')) {
      chunks = integrator(options.messages)
    } else {
      chunks = manager(options.messages)
    }
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'crew-fixture-llm'
/** Services required by the deterministic adapter and one-shot approval answerer. */
export const inject = ['llm', 'approval']

/** Register the fixture model and grant only the profile's one local commit request. */
export function apply(ctx) {
  if (process.env.DSH_SNAPSHOT !== 'replay' && process.env.DSH_SNAPSHOT !== 'refresh') {
    ctx.llm.registerAdapter(['deepseek-official'], new CrewFixtureAdapter())
  }
  ctx.on('approval/request', request => request.toolName === 'crew_commit' ? Promise.resolve('allowed-once') : undefined)
}
