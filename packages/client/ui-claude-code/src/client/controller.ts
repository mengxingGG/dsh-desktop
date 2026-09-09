/** Account snapshots and bounded login polling owned outside React components. */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClaudeAccountStatus, ClaudeLoginId, ClaudeLoginSnapshot, ClaudeQuotaSnapshot } from '@deepseek-ai/dsh-subagent-claude-code/engine-types'

/** Public account, quota and native login facts returned by the Remote service. */
export interface AccountValue {
  account: ClaudeAccountStatus | null
  quota: ClaudeQuotaSnapshot | null
  login: ClaudeLoginSnapshot | null
}
/** Remote operations required by the account settings controller. */
export interface AccountOperations {
  status(): Promise<AccountValue>
  quota(): Promise<ClaudeQuotaSnapshot | null>
  start(): Promise<ClaudeLoginSnapshot>
  poll(): Promise<ClaudeLoginSnapshot | null>
  input(id: ClaudeLoginId, code: string): Promise<void>
  cancel(id: ClaudeLoginId): Promise<void>
}
/** Account data and action state observed by the settings section. */
export interface AccountSnapshot {
  readonly value: AccountValue | null
  readonly busy: boolean
  readonly error: string | null
}
/** Framework-independent actions and observables supplied to the React section. */
export interface AccountInjected {
  hooks: { account: ClaudeAccountController['store'] }
  load(): void
  refresh(): void
  refreshQuota(): void
  startLogin(): void
  cancelLogin(): void
  submitCode(code: string): void
}

/** Serializes account actions and stops stale responses after plugin disposal. */
export class ClaudeAccountController {
  /** Observable account state; disposal fences outstanding responses. */
  readonly store = createSnapshotStore<AccountSnapshot>({ value: null, busy: false, error: null })
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private opened = false

  constructor(private readonly operations: AccountOperations, private readonly pollMs: number) {}

  /**
   * Bind account actions to this controller's lifetime.
   * @returns plain operations and the framework-bound account observable.
   */
  inject(): AccountInjected {
    return {
      hooks: { account: this.store }, load: () => { if (!this.opened) { this.opened = true; this.refresh() } },
      refresh: () =>{  this.refresh() }, refreshQuota: () => { void this.run(async () => {
        const quota = await this.operations.quota()
        const current = this.store.getSnapshot().value
        return current === null ? { ...await this.operations.status(), quota } : { ...current, quota }
      }) },
      startLogin: () => { void this.run(async () => {
        const login = await this.operations.start()
        return { ...(this.store.getSnapshot().value ?? { account: null, quota: null }), login }
      }) },
      cancelLogin: () => { void this.run(async () => {
        const login = this.store.getSnapshot().value?.login
        if (login !== null && login !== undefined) await this.operations.cancel(login.id)
        return this.operations.status()
      }) },
      submitCode: (code) => { void this.run(async () => {
        const login = this.store.getSnapshot().value?.login
        if (login === null || login === undefined) throw new Error('Claude login is unavailable')
        await this.operations.input(login.id, code)
        return this.operations.status()
      }) },
    }
  }

  /** Read current account facts after an explicit refresh or connection reset. */
  refresh(): void {
    if (this.opened) void this.run(async () => {
      const value = await this.operations.status()
      if (!this.active()) return value
      this.store.set({ value, busy: true, error: null })
      return value.account?.loggedIn === true ? { ...value, quota: await this.operations.quota() } : value
    })
  }

  private active(): boolean { return !this.disposed }

  private async run(action: () => Promise<AccountValue>): Promise<void> {
    if (!this.active() || this.store.getSnapshot().busy) return
    clearTimeout(this.timer)
    this.store.set({ ...this.store.getSnapshot(), busy: true, error: null })
    try {
      const value = await action()
      if (this.active()) this.store.set({ value, busy: false, error: null })
    } catch (error) {
      if (this.active()) this.store.set({
        ...this.store.getSnapshot(), busy: false, error: error instanceof Error ? error.message : String(error),
      })
    }
    if (this.active() && this.store.getSnapshot().value?.login?.status === 'running') {
      this.timer = setTimeout(() => { void this.run(async () => {
        const login = await this.operations.poll()
        const current = this.store.getSnapshot().value
        if (current === null || login?.status !== 'running') return this.operations.status()
        return { ...current, login }
      }) }, this.pollMs)
    }
  }

  /** Stop polling and fence outstanding Remote responses. */
  dispose(): void { this.disposed = true; clearTimeout(this.timer) }
}
