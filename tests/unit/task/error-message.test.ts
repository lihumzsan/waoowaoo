import { describe, expect, it } from 'vitest'
import { resolveTaskErrorMessage, resolveTaskErrorSummary } from '@/lib/task/error-message'
import type { UserErrorTranslator } from '@/lib/errors/user-messages'

const ZH: Partial<Record<Parameters<UserErrorTranslator>[0], string>> = {
  CONFLICT: '资源状态冲突',
  MODEL_NOT_OPEN: '模型权限未开通。https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model',
  EMPTY_RESPONSE: '模型返回空响应',
  NETWORK_ERROR: '网络异常，请稍后重试。',
  INSUFFICIENT_BALANCE: '余额不足，请充值后重试',
}
const translateZh: UserErrorTranslator = (code) => ZH[code] ?? code

describe('task error message normalization', () => {
  it('maps TASK_CANCELLED to unified cancelled message', () => {
    const summary = resolveTaskErrorSummary({
      errorCode: 'TASK_CANCELLED',
      errorMessage: 'whatever',
    }, 'Task failed', translateZh)
    expect(summary.cancelled).toBe(true)
    expect(summary.code).toBe('CONFLICT')
    expect(summary.message).toBe('资源状态冲突')
  })

  it('keeps cancelled semantics from normalized task error details', () => {
    const summary = resolveTaskErrorSummary({
      error: {
        code: 'CONFLICT',
        message: 'Task cancelled by user',
        details: { cancelled: true, originalCode: 'TASK_CANCELLED' },
      },
    }, 'Task failed', translateZh)
    expect(summary.cancelled).toBe(true)
    expect(summary.code).toBe('CONFLICT')
    expect(summary.message).toBe('资源状态冲突')
  })

  it('extracts nested error message from payload', () => {
    const message = resolveTaskErrorMessage({
      error: {
        details: {
          message: 'provider failed',
        },
      },
    }, 'fallback')
    expect(message).toBe('provider failed')
  })

  it('supports flat error/details string payload', () => {
    expect(resolveTaskErrorMessage({
      error: 'provider failed',
    }, 'fallback')).toBe('provider failed')

    expect(resolveTaskErrorMessage({
      details: 'provider failed',
    }, 'fallback')).toBe('provider failed')
  })

  it('uses fallback when payload has no structured error', () => {
    expect(resolveTaskErrorMessage({}, 'fallback')).toBe('fallback')
  })

  it('recognizes cancelled semantics from message-only payload', () => {
    const summary = resolveTaskErrorSummary({
      message: 'Task cancelled by user',
    }, 'Task failed', translateZh)
    expect(summary.cancelled).toBe(true)
    expect(summary.message).toBe('资源状态冲突')
  })

  it('prefers user-friendly message for MODEL_NOT_OPEN', () => {
    const summary = resolveTaskErrorSummary({
      error: {
        code: 'MODEL_NOT_OPEN',
        message: 'raw provider message should not be shown',
      },
    }, 'Task failed', translateZh)
    expect(summary.code).toBe('MODEL_NOT_OPEN')
    expect(summary.message).toContain('模型权限未开通')
    expect(summary.message).toContain('https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model')
  })

  it('prefers user-friendly message for EMPTY_RESPONSE', () => {
    const summary = resolveTaskErrorSummary({
      error: {
        code: 'EMPTY_RESPONSE',
        message: 'raw provider empty response',
      },
    }, 'Task failed', translateZh)
    expect(summary.code).toBe('EMPTY_RESPONSE')
    expect(summary.message).toContain('模型返回空响应')
  })

  it('prefers user-friendly message for NETWORK_ERROR', () => {
    const summary = resolveTaskErrorSummary({
      error: {
        code: 'NETWORK_ERROR',
        message: 'exception TypeError: fetch failed sending request',
      },
    }, 'Task failed', translateZh)
    expect(summary.code).toBe('NETWORK_ERROR')
    expect(summary.message).toBe('网络异常，请稍后重试。')
  })

  it('formats insufficient balance details from API error payload', () => {
    const summary = resolveTaskErrorSummary({
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: 'INSUFFICIENT_CREDITS: required=12.0000, available=3.5000',
        details: {
          required: 12,
          available: 3.5,
        },
      },
    }, 'Task failed', translateZh)

    expect(summary.code).toBe('INSUFFICIENT_BALANCE')
    expect(summary.message).toBe('余额不足，请充值后重试')
  })

})
