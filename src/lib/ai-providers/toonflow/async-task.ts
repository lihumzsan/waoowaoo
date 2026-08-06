import type {
  AsyncTaskProviderRegistration,
  ParsedAsyncExternalId,
} from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { queryToonflowVideoStatus } from './video'

function parseToonflowExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const [provider, type, requestId] = parts
  if (
    parts.length !== 3
    || provider !== 'TOONFLOW'
    || type !== 'VIDEO'
    || !requestId
  ) {
    throw new Error(`无效 TOONFLOW externalId: "${externalId}"，应为 TOONFLOW:VIDEO:taskICode`)
  }
  return {
    provider: 'TOONFLOW',
    type: 'VIDEO',
    requestId,
  }
}

export const toonflowAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'TOONFLOW',
  canParseExternalId: (externalId) => externalId.startsWith('TOONFLOW:'),
  parseExternalId: parseToonflowExternalId,
  formatExternalId: (input) => `TOONFLOW:${input.type}:${input.requestId}`,
  poll: async ({ parsed, context }) => {
    const { apiKey, baseUrl } = await context.getProviderConfig(context.userId, 'toonflow')
    const result = await queryToonflowVideoStatus({
      baseUrl,
      apiKey,
      taskCode: parsed.requestId,
    })
    if (result.status === 'pending') {
      return normalizeAsyncPollResult({ status: 'pending', pendingPhase: 'running' })
    }
    if (result.status === 'completed') {
      return normalizeAsyncPollResult({ status: 'completed', videoUrl: result.videoUrl })
    }
    return normalizeAsyncPollResult({
      status: 'failed',
      failure: result.failure,
    })
  },
}
