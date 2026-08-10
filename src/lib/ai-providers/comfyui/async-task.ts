import type { AsyncTaskProviderRegistration, ParsedAsyncExternalId } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { cancelComfyUiH3Video, pollComfyUiH3Video } from './h3'

function parseComfyUiExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  if (parts.length !== 3 || parts[0] !== 'COMFYUI' || parts[1] !== 'VIDEO' || !/^[0-9a-f-]{36}$/iu.test(parts[2])) {
    throw new Error(`Invalid COMFYUI externalId: ${externalId}`)
  }
  return { provider: 'COMFYUI', type: 'VIDEO', requestId: parts[2] }
}

export const comfyuiAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'COMFYUI',
  canParseExternalId: (externalId) => externalId.startsWith('COMFYUI:'),
  parseExternalId: parseComfyUiExternalId,
  formatExternalId: (input) => `COMFYUI:${input.type}:${input.requestId}`,
  poll: async ({ parsed }) => {
    const result = await pollComfyUiH3Video(parsed.requestId)
    if (result.status === 'pending') return normalizeAsyncPollResult(result)
    if (result.status === 'completed') return normalizeAsyncPollResult(result)
    return normalizeAsyncPollResult(result)
  },
  cancel: async ({ parsed }) => await cancelComfyUiH3Video(parsed.requestId),
}
