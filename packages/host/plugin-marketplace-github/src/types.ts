import type { Branded } from '@deepseek-ai/dsh-brand'

/** Canonical `owner/repository` identity returned by GitHub. */
export type MarketplaceRepository = Branded<'MarketplaceRepository'>

/** Validated npm package name declared by one marketplace bundle. */
export type MarketplacePackageName = Branded<'MarketplacePackageName'>

/** Manifest-validated public GitHub bundle rendered as one marketplace card. */
export interface MarketplaceEntry {
  readonly repository: MarketplaceRepository
  readonly packageName: MarketplacePackageName
  readonly description: string | null
  readonly htmlUrl: string
  readonly defaultBranch: string
  readonly stars: number
  readonly forks: number
  readonly license: string | null
  readonly updatedAt: string
}

/** Search text or exact GitHub repository identity. */
export interface MarketplaceSearchRequest {
  readonly query: string
}

/** Search result plus the current GitHub search allowance. */
export interface MarketplaceSearchResult {
  readonly entries: readonly MarketplaceEntry[]
  readonly rateLimitRemaining: number | null
}

/** Repository selected for installation after card review. */
export interface MarketplaceInstallRequest {
  readonly repository: MarketplaceRepository
}

/** Successful profile mutation returned to the browser. */
export interface MarketplaceInstallReceipt {
  readonly repository: MarketplaceRepository
  readonly packageName: MarketplacePackageName
  readonly restartRequired: true
}
