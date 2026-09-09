/** Validated public account and quota observations from the official Claude CLI. */

import { z } from 'zod'

/** Authentication status contains display facts only; the CLI owns credentials. */
export interface ClaudeAccountStatus {
  readonly loggedIn: boolean
  readonly method: string | null
  readonly provider: string | null
  readonly email: string | null
}

/** One account-shared usage window; missing utilization is unknown, never zero. */
export interface ClaudeQuotaWindow {
  readonly usedPercent: number | null
  readonly resetsAt: number | null
  readonly updatedAt: number
}

/** A timestamped observation, not an independently polled account balance. */
export interface ClaudeQuotaSnapshot {
  readonly status: 'allowed' | 'allowed_warning' | 'rejected'
  readonly windows: Readonly<Record<string, ClaudeQuotaWindow>>
  readonly usingOverage: boolean | null
  readonly updatedAt: number
}

const accountSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  apiProvider: z.string().optional(),
  email: z.string().nullable().optional(),
})
const windowSchema = z.object({
  utilization: z.number().nullable().optional(),
  resetsAt: z.number().nonnegative().nullable().optional(),
})
const quotaSchema = windowSchema.extend({
  status: z.enum(['allowed', 'allowed_warning', 'rejected']),
  rateLimitType: z.string().min(1).optional(),
  isUsingOverage: z.boolean().optional(),
  overageInUse: z.boolean().optional(),
  unifiedWindows: z.record(z.string(), windowSchema).optional(),
})

const usageWindow = z.object({
  utilization: z.number().min(0).max(100).nullable(),
  resets_at: z.iso.datetime({ offset: true }).nullable(),
})
const usageWindowKeys = ['five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_sonnet'] as const
const usageSchema = z.object({
  rate_limits_available: z.boolean(),
  rate_limits: z.object({
    five_hour: usageWindow.nullish(), seven_day: usageWindow.nullish(),
    seven_day_oauth_apps: usageWindow.nullish(), seven_day_opus: usageWindow.nullish(), seven_day_sonnet: usageWindow.nullish(),
    model_scoped: z.array(usageWindow.extend({ display_name: z.string() })).optional(),
  }).nullable(),
})

/**
 * Decode the SDK's structured usage command, whose utilization is already a percent.
 * @param raw - native control response; this experimental SDK method is version-pinned.
 * @param now - host observation time in epoch milliseconds.
 * @returns observed plan windows, or null when this account has no plan quota data.
 */
export function parseClaudeUsage(raw: unknown, now: number): ClaudeQuotaSnapshot | null {
  const value = usageSchema.parse(raw)
  if (!value.rate_limits_available || value.rate_limits === null) return null
  const windows: Record<string, ClaudeQuotaWindow> = {}
  const entries = [...usageWindowKeys.map(key => [key, value.rate_limits?.[key]] as const),
    ...(value.rate_limits.model_scoped ?? []).map(window => [`model:${window.display_name}`, window] as const)]
  for (const [key, window] of entries) {
    if (window == null) continue
    windows[key] = {
      usedPercent: window.utilization, resetsAt: window.resets_at === null ? null : Date.parse(window.resets_at), updatedAt: now,
    }
  }
  const usage = Object.values(windows).map(window => window.usedPercent ?? 0)
  return { status: usage.some(value => value >= 100) ? 'rejected' : 'allowed', windows, usingOverage: null, updatedAt: now }
}

/**
 * Decode the official `auth status --json` response without exposing credentials.
 * @param stdout - bounded CLI standard output.
 * @returns validated display facts; malformed output throws instead of implying logout.
 */
export function parseClaudeAccount(stdout: string): ClaudeAccountStatus {
  const value = accountSchema.parse(JSON.parse(stdout) as unknown)
  return {
    loggedIn: value.loggedIn, method: value.authMethod ?? null,
    provider: value.apiProvider ?? null, email: value.email ?? null,
  }
}

/**
 * Fold one SDK quota event, including newer CLI multi-window fields.
 * @param raw - process-origin rate_limit_info value.
 * @param previous - last observation for this same account.
 * @param now - host receipt time in epoch milliseconds.
 * @returns a snapshot preserving each unchanged window's own observation time.
 */
export function foldClaudeQuota(
  raw: unknown,
  previous: ClaudeQuotaSnapshot | null,
  now: number,
): ClaudeQuotaSnapshot {
  const value = quotaSchema.parse(raw)
  const windows = { ...previous?.windows }
  const rows = value.unifiedWindows ?? (value.rateLimitType === undefined ? {} : { [value.rateLimitType]: value })
  for (const [key, row] of Object.entries(rows)) {
    windows[key] = {
      usedPercent: row.utilization == null ? null : Math.max(0, Math.min(100, row.utilization * 100)),
      resetsAt: row.resetsAt == null ? null : row.resetsAt * 1000,
      updatedAt: now,
    }
  }
  return {
    status: value.status, windows,
    usingOverage: value.isUsingOverage ?? value.overageInUse ?? null,
    updatedAt: now,
  }
}
