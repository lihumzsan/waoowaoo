import type { ProviderAsyncTaskStatus } from '@/lib/ai-providers/shared/async-task-status'
import { logInternal } from '@/lib/logging/semantic'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { getErrorMessage } from '@/lib/ai-providers/shared/helpers'
import { describeUnknownError } from '@/lib/errors/normalize'
import { AppError } from '@/lib/errors/app-error'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import { readArkErrorCode, toArkPollHttpError } from './error'

interface UnknownRecord {
  [key: string]: unknown
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function readArkVideoUrl(content: unknown): string | undefined {
  const contentRecord = asRecord(content)
  if (contentRecord && typeof contentRecord.video_url === 'string' && contentRecord.video_url.trim()) {
    return contentRecord.video_url.trim()
  }

  if (!Array.isArray(content)) return undefined
  for (const item of content) {
    const itemRecord = asRecord(item)
    const videoUrl = asRecord(itemRecord?.video_url)
    if (videoUrl && typeof videoUrl.url === 'string' && videoUrl.url.trim()) {
      return videoUrl.url.trim()
    }
  }
  return undefined
}

export async function querySeedanceVideoStatus(
  taskId: string,
  input: { apiKey: string; baseUrl: string },
): Promise<ProviderAsyncTaskStatus> {
  const { apiKey, baseUrl } = input
  if (!apiKey) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'ark' })
  }

  try {
    const queryResponse = await fetchWithProviderProxy(
      `${baseUrl.replace(/\/+$/, '')}/contents/generations/tasks/${taskId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        cache: 'no-store',
      },
    )

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text()
      logInternal('Seedance', 'ERROR', `Status query failed: ${queryResponse.status}`)
      throw toArkPollHttpError(queryResponse.status, errorText)
    }

    const queryData = await queryResponse.json() as {
      status?: unknown
      usage?: { total_tokens?: unknown }
      content?: unknown
      error?: { code?: unknown; message?: unknown }
    }
    const status = queryData.status
    const actualVideoTokens = typeof queryData.usage?.total_tokens === 'number'
      ? queryData.usage.total_tokens
      : undefined

    if (status === 'succeeded') {
      const videoUrl = readArkVideoUrl(queryData.content)

      if (videoUrl) {
        return {
          status: 'completed',
          videoUrl,
          ...(typeof actualVideoTokens === 'number' ? { actualVideoTokens } : {}),
        }
      }

      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'ark',
          code: 'EMPTY_RESPONSE',
          message: 'No video URL in response',
          cause: queryData,
        }),
      }
    }

    if (status === 'failed') {
      const errorMessage = typeof queryData.error?.message === 'string'
        ? queryData.error.message
        : queryData.error
          ? describeUnknownError(queryData.error)
          : 'Unknown error'
      const errorCode = readArkErrorCode(queryData.error) ?? 'EXTERNAL_ERROR'
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'ark',
          code: errorCode,
          message: errorMessage,
          cause: queryData.error,
        }),
      }
    }

    if (status === 'cancelled' || status === 'canceled') {
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'ark',
          code: 'EXTERNAL_ERROR',
          message: `Ark task ${status}`,
          cause: queryData,
        }),
      }
    }

    if (status === 'queued' || status === 'running') return { status: 'pending' }
    throw new Error(`ARK_VIDEO_STATUS_UNKNOWN:${String(status)}`)
  } catch (error: unknown) {
    logInternal('Seedance', 'ERROR', 'Query error', { error: getErrorMessage(error) })
    throw error
  }
}
