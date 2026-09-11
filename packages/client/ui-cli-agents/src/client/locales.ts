/** Locale-owned native CLI account and invocation labels. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { cliAgents: keyof typeof en } }
/** English native CLI labels. */
export const en = {
  title: 'External CLIs', description: 'Grok, Antigravity and Codex can power the main agent or individual Crew roles. Existing native accounts are reused.',
  grok: 'Grok CLI', agy: 'Antigravity CLI', codex: 'Codex CLI', refresh: 'Refresh account and models', login: 'Open native sign-in',
  close: 'Close sign-in and refresh', send: 'Send input', enter: 'Enter', up: 'Up', down: 'Down',
  input: 'Native sign-in input', open: 'Open authorization page', installed: 'Installed', missing: 'Unavailable',
  signedIn: 'Account verified', unknown: 'Unknown', modelCount: 'Models', error: 'Native CLI response',
  quota: 'Quota', refreshQuota: 'Query quota manually', noQuota: 'No supported headless quota query; remaining quota is unknown.',
  quotaHint: 'Antigravity quota is queried only on request. Its CLI may consume a request or refuse permissions; DSH does not enable unrestricted permissions.',
  codexQuotaHint: 'Codex reads native account quota without a model request. Windows and reset times reflect the latest manual query.',
  used: 'used', reset: 'resets', observed: 'Observed', output: 'Native sign-in output', running: 'Native terminal open',
  loading: 'Loading…', context: 'Context', inputTokens: 'Input', outputTokens: 'Output', cache: 'Cache read',
  cost: 'Invocation cost (USD)', usageHint: 'Counts describe this CLI invocation. Antigravity and Codex cumulative counters are differenced; context capacity is shown only when reported.',
  adapterHint: 'Responses appear after completion and tools execute through DSH. Codex supports its native reasoning levels. Images, temperature, stop sequences and output-token overrides are not supported.',
}
/** Chinese native CLI labels. */
export const zh: Record<keyof typeof en, string> = {
  title: '外部 CLI', description: 'Grok、Antigravity 和 Codex 可用于主智能体或各个 Crew 角色，并复用已有原生账号。',
  grok: 'Grok CLI', agy: 'Antigravity CLI', codex: 'Codex CLI', refresh: '刷新账号和模型', login: '打开原生登录',
  close: '关闭登录并刷新', send: '发送输入', enter: '回车', up: '上移', down: '下移',
  input: '原生登录输入', open: '打开授权页面', installed: '已安装', missing: '不可用',
  signedIn: '账号已验证', unknown: '未知', modelCount: '模型数', error: '原生 CLI 响应',
  quota: '额度', refreshQuota: '手动查询额度', noQuota: '没有可用的无头额度查询接口，剩余额度未知。',
  quotaHint: 'Antigravity 仅在手动操作时查询额度。CLI 可能消耗一次请求或拒绝权限；DSH 不会开启无限制权限。',
  codexQuotaHint: 'Codex 直接读取原生账号额度，不发起模型请求。额度窗口和重置时间以最近一次手动查询为准。',
  used: '已用', reset: '重置', observed: '观测时间', output: '原生登录输出', running: '原生终端已打开',
  loading: '加载中…', context: '上下文', inputTokens: '输入', outputTokens: '输出', cache: '缓存读取',
  cost: '本次成本（美元）', usageHint: '计数对应本次 CLI 调用。Antigravity 和 Codex 的累计计数按差值展示；仅在 CLI 提供时显示上下文容量。',
  adapterHint: '正文在响应完成后显示，工具交由 DSH 执行。Codex 支持选择原生推理强度；暂不支持图片、温度、停止序列及输出令牌上限覆盖。',
}
