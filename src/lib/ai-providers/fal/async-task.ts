import type {
  AsyncTaskProviderRegistration,
  FormatAsyncExternalIdInput,
  ParsedAsyncExternalId,
} from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { cancelFalTask, queryFalStatus } from './queue'

function parseFalExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const type = parts[1]
  if (type === 'VIDEO' || type === 'IMAGE' || type === 'MUSIC' || type === 'VOICE') {
    if (parts.length < 4) {
      throw new Error(`无效 FAL externalId: "${externalId}"，应为 FAL:TYPE:endpoint:requestId`)
    }
    const endpoint = parts.slice(2, -1).join(':')
    const requestId = parts[parts.length - 1]
    if (!endpoint || !requestId) {
      throw new Error(`无效 FAL externalId: "${externalId}"，缺少 endpoint 或 requestId`)
    }
    return {
      provider: 'FAL',
      type,
      endpoint,
      requestId,
    }
  }
  throw new Error(`无效 FAL externalId: "${externalId}"，TYPE 仅支持 VIDEO/IMAGE/MUSIC/VOICE`)
}

function formatFalExternalId(input: FormatAsyncExternalIdInput): string {
  if (!input.endpoint) {
    throw new Error('FAL externalId requires endpoint')
  }
  return `FAL:${input.type}:${input.endpoint}:${input.requestId}`
}

export const falAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'FAL',
  canParseExternalId: (externalId) => externalId.startsWith('FAL:'),
  parseExternalId: parseFalExternalId,
  formatExternalId: formatFalExternalId,
  poll: async ({ parsed, context }) => {
    if (!parsed.endpoint) throw new Error('FAL_ENDPOINT_MISSING')
    const { apiKey } = await context.getProviderConfig(context.userId, 'fal')
    const result = await queryFalStatus(parsed.endpoint, parsed.requestId, apiKey)
    const pending = !result.failed && !result.completed
    return normalizeAsyncPollResult({
      status: result.failed ? 'failed' : result.completed ? 'completed' : 'pending',
      // FAL 官方队列区分 IN_QUEUE（排队）与 IN_PROGRESS（生成中）；分别计入
      // 排队预算与生成预算（async-wait 的双计时协议）。
      ...(pending ? { pendingPhase: result.status === 'IN_QUEUE' ? 'queued' as const : 'running' as const } : {}),
      failureDisposition: result.failureDisposition,
      resultUrl: result.resultUrl,
      imageUrl: result.resultUrl,
      videoUrl: result.resultUrl,
      error: result.error,
    })
  },
  cancel: async ({ parsed, context }) => {
    if (!parsed.endpoint) throw new Error('FAL_ENDPOINT_MISSING')
    const { apiKey } = await context.getProviderConfig(context.userId, 'fal')
    await cancelFalTask(parsed.endpoint, parsed.requestId, apiKey)
  },
}
