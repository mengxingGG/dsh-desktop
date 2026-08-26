/** Package-manager launcher selection for profile plugin commands. */

import { describe, expect, it } from 'vitest'
import { resolvePluginPnpmInvocation } from '../src/plugin.ts'

describe('resolvePluginPnpmInvocation', () => {
  it('runs a supplied pnpm JavaScript entry through the current Node.js executable', () => {
    expect(resolvePluginPnpmInvocation(
      ['add', 'bundle'],
      { npm_execpath: String.raw`C:\runtime\pnpm\bin\pnpm.cjs` },
      'win32',
      String.raw`C:\runtime\node.exe`,
    )).toEqual({
      command: String.raw`C:\runtime\node.exe`,
      args: [String.raw`C:\runtime\pnpm\bin\pnpm.cjs`, 'add', 'bundle'],
      shell: false,
    })
  })

  it('keeps PATH pnpm and the Windows command-shim shell fallback', () => {
    expect(resolvePluginPnpmInvocation(['root'], { npm_execpath: '/npm/npm-cli.js' }, 'win32', 'node'))
      .toEqual({ command: 'pnpm', args: ['root'], shell: true })
    expect(resolvePluginPnpmInvocation(['root'], {}, 'linux', 'node'))
      .toEqual({ command: 'pnpm', args: ['root'], shell: false })
  })
})
