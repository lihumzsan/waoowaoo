import {
  createProviderAsyncTaskFailure,
  type ProviderAsyncTaskStatus,
} from '@/lib/ai-providers/shared/async-task-status'
import { logInternal } from '@/lib/logging/semantic'
import { withProviderProxyDispatcher } from '@/lib/http/outbound-proxy'
import { GOOGLE_PROVIDER_PROXY_TARGET } from '@/lib/ai-providers/google/proxy-target'
import { getErrorMessage } from '@/lib/ai-providers/shared/helpers'
import { AppError } from '@/lib/errors/app-error'

interface UnknownRecord {
  [key: string]: unknown
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function getErrorStatus(error: unknown): number | undefined {
  const record = asRecord(error)
  if (!record) return undefined
  return typeof record.status === 'number' ? record.status : undefined
}

interface GeminiBatchClient {
  batches: {
    get(args: { name: string }): Promise<unknown>
  }
}

export async function queryGeminiBatchStatus(batchName: string, apiKey: string): Promise<ProviderAsyncTaskStatus> {
  if (!apiKey) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'google' })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey })
    const batchClient = ai as unknown as GeminiBatchClient
    const batchJob = await withProviderProxyDispatcher(
      GOOGLE_PROVIDER_PROXY_TARGET,
      async () => await batchClient.batches.get({ name: batchName }),
    )
    const batchRecord = asRecord(batchJob) || {}

    const state = typeof batchRecord.state === 'string' ? batchRecord.state : 'UNKNOWN'
    logInternal('GeminiBatch', 'INFO', `查询状态: ${batchName} -> ${state}`)

    if (state === 'JOB_STATE_SUCCEEDED') {
      const dest = asRecord(batchRecord.dest)
      const responses = Array.isArray(dest?.inlinedResponses) ? dest.inlinedResponses : []

      if (responses.length > 0) {
        const firstResponse = asRecord(responses[0])
        const response = asRecord(firstResponse?.response)
        const candidates = Array.isArray(response?.candidates) ? response.candidates : []
        const firstCandidate = asRecord(candidates[0])
        const content = asRecord(firstCandidate?.content)
        const parts = Array.isArray(content?.parts) ? content.parts : []

        for (const part of parts) {
          const partRecord = asRecord(part)
          const inlineData = asRecord(partRecord?.inlineData)
          if (typeof inlineData?.data === 'string') {
            const imageBase64 = inlineData.data
            const mimeType = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png'
            const imageUrl = `data:${mimeType};base64,${imageBase64}`

            logInternal('GeminiBatch', 'INFO', `✅ 获取到图片，MIME 类型: ${mimeType}`, { batchName })
            return { status: 'completed', imageUrl }
          }
        }
      }

      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google', code: 'EMPTY_RESPONSE', message: 'No image data in batch result',
          cause: batchJob,
        }),
      }
    }

    if (
      state === 'JOB_STATE_FAILED'
      || state === 'JOB_STATE_CANCELLED'
      || state === 'JOB_STATE_EXPIRED'
      || state === 'JOB_STATE_PARTIALLY_SUCCEEDED'
    ) {
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google', code: 'EXTERNAL_ERROR', message: `Gemini Batch failed: ${state}`,
          cause: batchJob,
        }),
      }
    }

    if (
      state === 'JOB_STATE_QUEUED'
      || state === 'JOB_STATE_PENDING'
      || state === 'JOB_STATE_RUNNING'
      || state === 'JOB_STATE_CANCELLING'
      || state === 'JOB_STATE_PAUSED'
      || state === 'JOB_STATE_UPDATING'
    ) return { status: 'pending' }
    throw new Error(`GEMINI_BATCH_STATUS_UNKNOWN:${state}`)
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    const status = getErrorStatus(error)
    logInternal('GeminiBatch', 'ERROR', 'Query error', { batchName, error: message, status })
    if (status === 404) {
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google', code: 'NOT_FOUND', message: 'Batch task not found',
          cause: error,
        }),
      }
    }
    throw error
  }
}

export async function queryGoogleVideoStatus(operationName: string, apiKey: string): Promise<ProviderAsyncTaskStatus> {
  if (!apiKey) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'google' })
  }

  const logPrefix = '[Veo Query]'

  try {
    const { GoogleGenAI, GenerateVideosOperation } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey })
    const operation = new GenerateVideosOperation()
    operation.name = operationName
    const op = await withProviderProxyDispatcher(
      GOOGLE_PROVIDER_PROXY_TARGET,
      async () => await ai.operations.getVideosOperation({ operation }),
    )

    logInternal('Veo', 'INFO', `${logPrefix} 原始响应`, {
      operationName,
      done: op.done,
      hasError: !!op.error,
      hasResponse: !!op.response,
      responseKeys: op.response ? Object.keys(op.response) : [],
      generatedVideosCount: op.response?.generatedVideos?.length ?? 0,
      raiFilteredCount: (op.response as UnknownRecord)?.raiMediaFilteredCount ?? null,
      raiFilteredReasons: (op.response as UnknownRecord)?.raiMediaFilteredReasons ?? null,
    })

    if (!op.done) {
      return { status: 'pending' }
    }

    if (op.error) {
      const errRecord = asRecord(op.error)
      const message = (typeof errRecord?.message === 'string' && errRecord.message)
        || (typeof errRecord?.statusMessage === 'string' && errRecord.statusMessage)
        || 'Veo 任务失败'
      logInternal('Veo', 'ERROR', `${logPrefix} 操作级错误`, { operationName, error: op.error })
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google', code: 'EXTERNAL_ERROR', message,
          cause: op.error,
        }),
      }
    }

    const response = op.response
    if (!response) {
      logInternal('Veo', 'ERROR', `${logPrefix} done=true 但 response 为空`, { operationName })
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google', code: 'EMPTY_RESPONSE', message: 'Veo 任务完成但响应体为空',
          cause: op,
        }),
      }
    }

    const responseRecord = asRecord(response) || {}
    const raiFilteredCount = responseRecord.raiMediaFilteredCount
    const raiFilteredReasons = responseRecord.raiMediaFilteredReasons

    if (typeof raiFilteredCount === 'number' && raiFilteredCount > 0) {
      const reasons = Array.isArray(raiFilteredReasons)
        ? raiFilteredReasons.join(', ')
        : '未知原因'
      logInternal('Veo', 'ERROR', `${logPrefix} 视频被 RAI 安全策略过滤`, {
        operationName,
        raiFilteredCount,
        raiFilteredReasons: reasons,
      })
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google',
          code: 'SENSITIVE_CONTENT',
          message: `Veo 视频被安全策略过滤 (${raiFilteredCount} 个视频被过滤, 原因: ${reasons})`,
          cause: response,
        }),
      }
    }

    const generatedVideos = response.generatedVideos
    if (Array.isArray(generatedVideos) && generatedVideos.length > 0) {
      const first = generatedVideos[0]
      const videoUri = first?.video?.uri

      if (videoUri) {
        logInternal('Veo', 'INFO', `${logPrefix} 成功获取视频`, {
          operationName,
          videoUri: videoUri.substring(0, 80),
        })
        return { status: 'completed', videoUrl: videoUri }
      }

      logInternal('Veo', 'ERROR', `${logPrefix} generatedVideos[0] 存在但无 video.uri`, {
        operationName,
        firstVideo: JSON.stringify(first, null, 2),
      })
      return {
        status: 'failed',
        failure: createProviderAsyncTaskFailure({
          provider: 'google', code: 'EMPTY_RESPONSE', message: 'Veo 视频对象存在但缺少 URI',
          cause: first,
        }),
      }
    }

    logInternal('Veo', 'ERROR', `${logPrefix} 无 generatedVideos`, {
      operationName,
      responseKeys: Object.keys(responseRecord),
      fullResponse: JSON.stringify(responseRecord, null, 2).substring(0, 2000),
      raiFilteredCount: raiFilteredCount ?? 'N/A',
      raiFilteredReasons: raiFilteredReasons ?? 'N/A',
    })
    return {
      status: 'failed',
      failure: createProviderAsyncTaskFailure({
        provider: 'google', code: 'EMPTY_RESPONSE', message: 'Veo 任务完成但未返回视频 (generatedVideos 为空)',
        cause: response,
      }),
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error)
    logInternal('Veo', 'ERROR', `${logPrefix} 查询异常`, { operationName, error: message })
    throw error
  }
}
