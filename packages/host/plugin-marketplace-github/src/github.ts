/** GitHub REST discovery with root-manifest validation for dsh bundles. */

import type {
  MarketplaceEntry,
  MarketplacePackageName,
  MarketplaceRepository,
  MarketplaceSearchResult,
} from './types.ts'

const API_ROOT = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const MAX_QUERY_CHARACTERS = 100
const MAX_MANIFEST_BYTES = 128 * 1024
const VALIDATION_CONCURRENCY = 4
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** GitHub request policy resolved from plugin configuration. */
export interface GitHubOptions {
  readonly fetch?: typeof fetch
  readonly maxResults: number
  readonly requestTimeoutMs: number
  readonly token?: string
  readonly topic: string
}

interface GitHubRepository {
  readonly fullName: MarketplaceRepository
  readonly description: string | null
  readonly htmlUrl: string
  readonly defaultBranch: string
  readonly stars: number
  readonly forks: number
  readonly license: string | null
  readonly updatedAt: string
}

/** Validated card plus the package-manager spec kept on the Host. */
export interface InspectedPlugin extends MarketplaceEntry {
  readonly installSpec: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  return typeof record[field] === 'string' ? record[field] : undefined
}

function numberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requestHeaders(token?: string, raw = false): Record<string, string> {
  return {
    accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'user-agent': 'deepseek-harness-plugin-marketplace',
    'x-github-api-version': API_VERSION,
    ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
  }
}

function assertResponse(response: Response, subject: string): void {
  if (response.ok) return
  throw new Error(`${subject} failed with HTTP ${String(response.status)}`)
}

function rateRemaining(response: Response): number | null {
  const raw = response.headers.get('x-ratelimit-remaining')
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
}

function parseLicense(value: unknown): string | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const spdx = stringField(value, 'spdx_id')
  return spdx === undefined || spdx === 'NOASSERTION' ? null : spdx
}

function marketplacePackageName(value: unknown): MarketplacePackageName | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.dsh)) return undefined
  if (!isRecord(value.dsh.bundle) || typeof value.dsh.bundle.patch !== 'string') return undefined
  if (value.name.length > 214 || !NPM_PACKAGE_NAME.test(value.name)) return undefined
  return value.name as MarketplacePackageName
}

/**
 * Parse an `owner/repository` slug or exact HTTPS GitHub repository URL.
 * @param input - user-entered repository identity or URL.
 * @returns canonical repository identity, or `undefined` for any other input.
 */
export function parseRepositoryInput(input: string): MarketplaceRepository | undefined {
  const trimmed = input.trim()
  const slug = /^(?<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/(?<repo>[A-Za-z0-9_.-]{1,100})$/.exec(trimmed)
  if (slug?.groups?.owner !== undefined && slug.groups.repo !== undefined) {
    return `${slug.groups.owner}/${slug.groups.repo.replace(/\.git$/, '')}` as MarketplaceRepository
  }
  let url: URL
  try { url = new URL(trimmed) } catch { return undefined }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.search !== '' || url.hash !== '') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  return parts.length === 2 ? parseRepositoryInput(`${parts[0]}/${parts[1]}`) : undefined
}

function parseRepository(value: unknown): GitHubRepository | undefined {
  if (!isRecord(value)) return undefined
  const fullName = stringField(value, 'full_name')
  const htmlUrl = stringField(value, 'html_url')
  const defaultBranch = stringField(value, 'default_branch')
  const stars = numberField(value, 'stargazers_count')
  const forks = numberField(value, 'forks_count')
  const updatedAt = stringField(value, 'updated_at')
  const description = value.description === null || typeof value.description === 'string' ? value.description : undefined
  const license = parseLicense(value.license)
  if (fullName === undefined || htmlUrl === undefined || defaultBranch === undefined || defaultBranch === ''
    || stars === undefined || forks === undefined || updatedAt === undefined || !Number.isFinite(Date.parse(updatedAt))
    || description === undefined || license === undefined) return undefined
  const repository = parseRepositoryInput(fullName)
  if (repository === undefined || value.private !== false || value.archived === true || value.disabled === true) return undefined
  if (htmlUrl !== `https://github.com/${repository}`) return undefined
  return { fullName: repository, description, htmlUrl, defaultBranch, stars, forks, license, updatedAt }
}

async function fetchRepository(
  fullName: MarketplaceRepository,
  options: GitHubOptions,
): Promise<{ repository?: GitHubRepository; remaining: number | null }> {
  const response = await (options.fetch ?? fetch)(
    `${API_ROOT}/repos/${fullName.split('/').map(encodeURIComponent).join('/')}`,
    { headers: requestHeaders(options.token), signal: AbortSignal.timeout(options.requestTimeoutMs) },
  )
  if (response.status === 404) return { remaining: rateRemaining(response) }
  assertResponse(response, 'GitHub repository request')
  const repository = parseRepository(await response.json())
  return { ...(repository === undefined ? {} : { repository }), remaining: rateRemaining(response) }
}

async function inspectManifest(repository: GitHubRepository, options: GitHubOptions): Promise<InspectedPlugin | undefined> {
  const [owner, name] = repository.fullName.split('/')
  if (owner === undefined || name === undefined) return undefined
  const response = await (options.fetch ?? fetch)(
    `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/package.json?ref=${encodeURIComponent(repository.defaultBranch)}`,
    { headers: requestHeaders(options.token, true), signal: AbortSignal.timeout(options.requestTimeoutMs) },
  )
  if (response.status === 404) return undefined
  assertResponse(response, `package.json request for ${repository.fullName}`)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) return undefined
  let manifest: unknown
  try { manifest = JSON.parse(text) } catch { return undefined }
  const packageName = marketplacePackageName(manifest)
  if (packageName === undefined) return undefined
  return {
    repository: repository.fullName,
    packageName,
    description: repository.description,
    htmlUrl: repository.htmlUrl,
    defaultBranch: repository.defaultBranch,
    stars: repository.stars,
    forks: repository.forks,
    license: repository.license,
    updatedAt: repository.updatedAt,
    installSpec: `github:${repository.fullName}`,
  }
}

/**
 * Revalidate one repository immediately before installation.
 * @param input - exact repository identity or GitHub URL selected by the user.
 * @param options - GitHub request policy and optional fetch implementation.
 * @returns validated repository and install metadata, or `undefined` when validation rejects it.
 */
export async function inspectPlugin(input: string, options: GitHubOptions): Promise<InspectedPlugin | undefined> {
  const fullName = parseRepositoryInput(input)
  if (fullName === undefined) return undefined
  const result = await fetchRepository(fullName, options)
  return result.repository === undefined ? undefined : inspectManifest(result.repository, options)
}

/**
 * Search a GitHub topic and retain repositories whose root package declares a dsh bundle.
 * @param query - keyword, exact repository identity, repository URL, or blank popular-search query.
 * @param options - GitHub request, topic, timeout, and result-limit policy.
 * @returns validated marketplace cards and GitHub's reported remaining request allowance.
 */
export async function searchPlugins(query: string, options: GitHubOptions): Promise<MarketplaceSearchResult> {
  const trimmed = query.trim()
  if (trimmed.length > MAX_QUERY_CHARACTERS) throw new Error('plugin search query exceeds 100 characters')
  const direct = parseRepositoryInput(trimmed)
  if (direct !== undefined) {
    const result = await fetchRepository(direct, options)
    const inspected = result.repository === undefined ? undefined : await inspectManifest(result.repository, options)
    return {
      entries: inspected === undefined ? [] : [inspected],
      rateLimitRemaining: result.remaining,
    }
  }
  const url = new URL('/search/repositories', API_ROOT)
  url.searchParams.set('q', [trimmed, `topic:${options.topic}`, 'fork:false', 'archived:false'].filter(Boolean).join(' '))
  url.searchParams.set('per_page', String(options.maxResults))
  url.searchParams.set('sort', 'stars')
  url.searchParams.set('order', 'desc')
  const response = await (options.fetch ?? fetch)(url, {
    headers: requestHeaders(options.token),
    signal: AbortSignal.timeout(options.requestTimeoutMs),
  })
  assertResponse(response, 'GitHub plugin search')
  const payload: unknown = await response.json()
  const repositories = (isRecord(payload) && Array.isArray(payload.items) ? payload.items : [])
    .map(parseRepository)
    .filter(repository => repository !== undefined)
  const entries: MarketplaceEntry[] = []
  for (let index = 0; index < repositories.length; index += VALIDATION_CONCURRENCY) {
    const validated = await Promise.all(
      repositories.slice(index, index + VALIDATION_CONCURRENCY).map(repository => inspectManifest(repository, options)),
    )
    for (const entry of validated) if (entry !== undefined) entries.push(entry)
  }
  return { entries, rateLimitRemaining: rateRemaining(response) }
}
