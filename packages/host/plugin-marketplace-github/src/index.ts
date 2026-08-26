/** GitHub plugin marketplace Remote for a DeepSeek Harness Web profile. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { inspectPlugin, searchPlugins, type GitHubOptions } from './github.ts'
import { installPlugin } from './installer.ts'
import type {
  MarketplaceInstallReceipt,
  MarketplaceInstallRequest,
  MarketplaceSearchRequest,
  MarketplaceSearchResult,
} from './types.ts'

export type * from './types.ts'

const DEFAULT_TOPIC = 'dsh-plugin'
const DEFAULT_MAX_RESULTS = 8
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000

/** Deployment controls resolved before the Remote becomes active. */
export interface Config {
  /** GitHub topic required by keyword and blank searches. */
  readonly topic?: string
  /** Maximum number of repositories validated for one search. */
  readonly searchMaxResults?: number
  /** Per-request GitHub timeout in milliseconds. */
  readonly requestTimeoutMs?: number
  /** Plugin installation process timeout in milliseconds. */
  readonly installTimeoutMs?: number
  /** dsh profile changed by a successful installation. */
  readonly profile?: string
  /** Host environment variable containing the optional GitHub token. */
  readonly tokenEnv?: string
}

interface ResolvedConfig {
  readonly topic: string
  readonly searchMaxResults: number
  readonly requestTimeoutMs: number
  readonly installTimeoutMs: number
  readonly profile: string
  readonly tokenEnv: string
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    topic: config.topic ?? DEFAULT_TOPIC,
    searchMaxResults: config.searchMaxResults ?? DEFAULT_MAX_RESULTS,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    installTimeoutMs: config.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
    profile: config.profile ?? 'web',
    tokenEnv: config.tokenEnv ?? 'GITHUB_TOKEN',
  }
}

/** GitHub-backed search and installation provider exposed through Typert Remote. */
export class PluginMarketplaceGateway extends TypertRemoteService {
  static Config: z<Config> = z.object({
    topic: z.string().default(DEFAULT_TOPIC),
    searchMaxResults: z.number().step(1).min(1).max(30).default(DEFAULT_MAX_RESULTS),
    requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
    installTimeoutMs: z.number().step(1).min(1).default(DEFAULT_INSTALL_TIMEOUT_MS),
    profile: z.string().pattern(/^[A-Za-z0-9._-]+$/).default('web'),
    tokenEnv: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('GITHUB_TOKEN'),
  })

  private readonly config: ResolvedConfig
  private readonly lifetime = new AbortController()
  private installation: Promise<MarketplaceInstallReceipt> | undefined

  /**
   * @param ctx - Host context owning the Remote service lifecycle.
   * @param config - optional GitHub, timeout, and target-profile policy.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginMarketplace')
    this.config = resolveConfig(config)
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('plugin marketplace disposed'))
      try {
        await this.installation
      } catch {
        // Disposal waits for the cancelled installer; its Remote caller owns the rejection.
      }
    }, 'plugin-marketplace.installation')
  }

  private githubOptions(): GitHubOptions {
    const token = process.env[this.config.tokenEnv]
    return {
      maxResults: this.config.searchMaxResults,
      requestTimeoutMs: this.config.requestTimeoutMs,
      topic: this.config.topic,
      ...(token === undefined || token === '' ? {} : { token }),
    }
  }

  /**
   * Search GitHub and retain public repositories whose root manifest declares a dsh bundle.
   * @param request - browser-provided keyword or exact repository query.
   * @returns validated cards and current GitHub request allowance.
   */
  @Remote('search')
  search(request: MarketplaceSearchRequest): Promise<MarketplaceSearchResult> {
    return searchPlugins(request.query, this.githubOptions())
  }

  /**
   * Revalidate and install one reviewed repository into the configured profile.
   * @param request - repository selected after browser review and confirmation.
   * @returns installed package identity and the required-restart signal.
   */
  @Remote('add')
  add(request: MarketplaceInstallRequest): Promise<MarketplaceInstallReceipt> {
    if (this.installation !== undefined) throw new Error('another plugin installation is running')
    const operation = this.installRepository(request)
    this.installation = operation
    const clear = (): void => {
      if (this.installation === operation) this.installation = undefined
    }
    void operation.then(clear, clear)
    return operation
  }

  private async installRepository(request: MarketplaceInstallRequest): Promise<MarketplaceInstallReceipt> {
    const entry = await inspectPlugin(request.repository, this.githubOptions())
    if (entry === undefined) throw new Error('repository root package.json does not declare a valid dsh.bundle.patch')
    const result = await installPlugin(entry, {
      profile: this.config.profile,
      signal: this.lifetime.signal,
      timeoutMs: this.config.installTimeoutMs,
    })
    if (result.code !== 0) {
      throw new Error(`plugin installer exited with code ${String(result.code)}\n${result.output}`)
    }
    return {
      repository: entry.repository,
      packageName: entry.packageName,
      restartRequired: true,
    }
  }
}

export default PluginMarketplaceGateway
