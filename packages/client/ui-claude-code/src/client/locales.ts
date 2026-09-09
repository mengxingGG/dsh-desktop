/** Locale-owned Claude account controls and quota explanations. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { claudeCode: ClaudeCodeKey }
}

/** Namespace registered with the Client locale service. */
export const NS = 'claudeCode' as const
/** English account settings copy. */
export const en = {
  context: 'Context', cacheHit: 'Cache hit', requestContext: 'Latest request context',
  uncachedInput: 'Uncached input', outputTokens: 'Output', cacheRead: 'Cache read', cacheWrite: 'Cache write', requestObserved: 'Request updated',
  usageExplanation: 'Counters describe the latest native model request, not cumulative conversation usage. Context includes uncached input and cache reads/writes, excludes output, and refreshes after native compaction. Capacity may remain unknown until the turn finishes.',
  quotaExplanation: 'Quota is shared by the account, not reserved for this agent. Visible conversations refresh it periodically without inference; timestamps show when each window was observed.',
  title: 'Claude Code', description: 'Use your Claude account for the main agent or individual Crew roles. Choose Claude Code in the model selector.',
  refresh: 'Refresh account', refreshQuota: 'Refresh quota', login: 'Sign in', cancel: 'Cancel sign-in', submit: 'Submit code', code: 'Authorization code',
  signedIn: 'Signed in', signedOut: 'Not signed in', unknown: 'Unknown', noQuota: 'Quota is unavailable for this account. Refreshing quota does not send a model request.',
  fiveHour: 'Five hours', sevenDay: 'Seven days', sevenDayOpus: 'Seven days · Opus', sevenDaySonnet: 'Seven days · Sonnet', oauthApps: 'Seven days · OAuth apps',
  used: 'Used', resets: 'Resets', observed: 'Updated', waiting: 'Complete authorization in the browser. If the CLI requests a code, paste it below.',
  output: 'Official CLI sign-in output', truncated: 'Earlier sign-in output was truncated.', open: 'Open authorization page',
  running: 'Waiting for authorization', completed: 'Sign-in completed', cancelled: 'Sign-in cancelled', failed: 'Sign-in failed', loading: 'Loading…',
} as const
/** Keys shared by account settings dictionaries. */
export type ClaudeCodeKey = keyof typeof en
/** Known native quota windows mapped to locale-owned labels. */
export const windowLabels: Readonly<Record<string, ClaudeCodeKey>> = {
  five_hour: 'fiveHour', seven_day: 'sevenDay', seven_day_opus: 'sevenDayOpus', seven_day_sonnet: 'sevenDaySonnet', seven_day_oauth_apps: 'oauthApps',
}
/** Chinese account settings copy. */
export const zh: Record<ClaudeCodeKey, string> = {
  context: '上下文', cacheHit: '缓存命中', requestContext: '最近请求上下文',
  uncachedInput: '未缓存输入', outputTokens: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入', requestObserved: '请求更新时间',
  usageExplanation: '这些计数属于最近一次原生模型请求，并非整段对话累计消耗。上下文包含未缓存输入和缓存读写，不含输出；原生压缩后重新观测。窗口容量可能需要等本轮结束才返回。',
  quotaExplanation: '额度由整个账号共享，不是该智能体的独立余额。显示对话时定期刷新，不发起推理请求；各窗口时间表示观测时间。',
  title: 'Claude Code', description: '主智能体和各个 Crew 角色可使用你的 Claude 账号。在模型选择器中选择 Claude Code 即可。',
  refresh: '刷新账号', refreshQuota: '刷新额度', login: '登录', cancel: '取消登录', submit: '提交授权码', code: '授权码',
  signedIn: '已登录', signedOut: '未登录', unknown: '未知', noQuota: '此账号暂时没有可用的额度数据。刷新额度不会发起模型请求。',
  fiveHour: '五小时', sevenDay: '七天', sevenDayOpus: '七天 · Opus', sevenDaySonnet: '七天 · Sonnet', oauthApps: '七天 · OAuth 应用',
  used: '已用', resets: '重置时间', observed: '更新时间', waiting: '请在浏览器完成授权。如果 CLI 要求输入授权码，请粘贴到下方。',
  output: '官方 CLI 登录输出', truncated: '较早的登录输出已被截断。', open: '打开授权页面',
  running: '等待授权', completed: '登录完成', cancelled: '登录已取消', failed: '登录失败', loading: '加载中…',
}
