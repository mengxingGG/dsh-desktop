/** HTTPS imports are available, but browser workers cannot open native TLS sockets. */
import { notImplementedFail } from '../../notImplementedFail.ts'

const MODULE = 'node:https'

/** Native TLS requests are unavailable; this refusal preserves caller-owned network policy. */
export const request: typeof import('node:https').request = notImplementedFail(MODULE, 'request')

/** Native TLS GET requests are unavailable in the worker host. */
export const get: typeof import('node:https').get = notImplementedFail(MODULE, 'get')

/** CommonJS interop marker for the worker loader. */
export const __esModule = true

/** CommonJS default namespace; neither operation substitutes browser fetch. */
export default { request, get } satisfies Partial<typeof import('node:https')>
