/**
 * 浏览器端错误上报单例。
 *
 * 唯一职责：把前端运行时错误（window error / unhandledrejection /
 * React render error boundary / 显式调用）投递到 POST /api/client-log。
 *
 * 硬约束：
 * - 上报绝不允许影响页面：任何内部失败静默吞掉。
 * - 相同 message+stack 在 60 秒窗口内只上报一次（去重）。
 * - 离线时直接丢弃，不排队、不重放。
 */

export type ClientErrorKind = 'error' | 'unhandledrejection' | 'react-render'

export interface ClientErrorReport {
  kind: ClientErrorKind
  message: string
  stack?: string
  /** 关联失败 API 请求的 requestId（若可得） */
  requestId?: string
  projectId?: string
}

const CLIENT_LOG_ENDPOINT = '/api/client-log'
const DEDUPE_WINDOW_MS = 60_000
const MAX_MESSAGE_LENGTH = 2_000
const MAX_STACK_LENGTH = 8_000
const MAX_URL_LENGTH = 1_000
const MAX_USER_AGENT_LENGTH = 400
const MAX_ID_LENGTH = 128

const recentReports = new Map<string, number>()

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function shouldReport(dedupeKey: string): boolean {
  const now = Date.now()
  for (const [key, reportedAt] of recentReports) {
    if (now - reportedAt > DEDUPE_WINDOW_MS) {
      recentReports.delete(key)
    }
  }
  const lastReportedAt = recentReports.get(dedupeKey)
  if (lastReportedAt !== undefined && now - lastReportedAt <= DEDUPE_WINDOW_MS) {
    return false
  }
  recentReports.set(dedupeKey, now)
  return true
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined') return
    // 离线直接丢弃：客户端上报只是可观测性补充，不承担持久化保证。
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return

    const message = truncate(report.message || 'Unknown client error', MAX_MESSAGE_LENGTH)
    const stack = report.stack ? truncate(report.stack, MAX_STACK_LENGTH) : undefined
    if (!shouldReport(`${message}\n${stack ?? ''}`)) return

    const body = JSON.stringify({
      kind: report.kind,
      message,
      ...(stack ? { stack } : {}),
      url: truncate(window.location.href, MAX_URL_LENGTH),
      userAgent: truncate(navigator.userAgent, MAX_USER_AGENT_LENGTH),
      ...(report.requestId ? { requestId: truncate(report.requestId, MAX_ID_LENGTH) } : {}),
      ...(report.projectId ? { projectId: truncate(report.projectId, MAX_ID_LENGTH) } : {}),
    })

    void fetch(CLIENT_LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    // 上报永远不能反过来破坏页面。
  }
}

function extractErrorParts(candidate: unknown): { message: string; stack?: string } {
  if (candidate instanceof Error) {
    return { message: candidate.message || candidate.name, stack: candidate.stack }
  }
  if (typeof candidate === 'string') {
    return { message: candidate }
  }
  // Arbitrary rejection objects frequently come from browser extensions and
  // may contain complete account/session objects. Their contents are neither
  // a stable error contract nor safe diagnostics, so record only the kind.
  const valueKind = candidate === null
    ? 'null'
    : Array.isArray(candidate) ? 'array' : typeof candidate
  return { message: `Unhandled rejection with non-Error ${valueKind} value` }
}

let installed = false

/**
 * 挂载全局监听（window error + unhandledrejection）。幂等：重复调用只生效一次。
 */
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  window.addEventListener('error', (event) => {
    const parts = event.error !== undefined && event.error !== null
      ? extractErrorParts(event.error)
      : { message: event.message || 'Unknown window error' }
    reportClientError({ kind: 'error', ...parts })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const parts = extractErrorParts(event.reason)
    reportClientError({ kind: 'unhandledrejection', ...parts })
  })
}
