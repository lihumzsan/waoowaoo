import type { AsyncTaskProviderRegistration } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { formatComfyUiExternalId, parseComfyUiExternalId } from './external-id'
import { cancelComfyUiMusic, pollComfyUiMusic } from './music-runtime'
import { cancelComfyUiH3Video, pollComfyUiH3Video } from './h3'

export const comfyuiAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'COMFYUI',
  providerKey: 'comfyui',
  canParseExternalId: (externalId) => externalId.startsWith('COMFYUI:'),
  parseExternalId: parseComfyUiExternalId,
  formatExternalId: (input) => formatComfyUiExternalId({
    targetId: input.endpoint as 'shared' | 'h3-dual-stage-2mp',
    type: input.type as 'VIDEO' | 'MUSIC',
    requestId: input.requestId,
  }),
  poll: async ({ parsed }) => {
    const result = parsed.type === 'MUSIC'
      ? await pollComfyUiMusic(parsed.requestId, parsed.endpoint)
      : await pollComfyUiH3Video(parsed.requestId, parsed.endpoint)
    if (result.status === 'pending') return normalizeAsyncPollResult(result)
    if (result.status === 'completed') {
      if (parsed.type === 'MUSIC') {
        if (!('audioUrl' in result)) throw new Error(`COMFYUI_${parsed.type}_RESULT_MISSING`)
        return normalizeAsyncPollResult({ status: 'completed', resultUrl: result.audioUrl })
      }
      if (!('temporaryMediaFile' in result)) throw new Error('COMFYUI_VIDEO_RESULT_MISSING')
      return normalizeAsyncPollResult({ status: 'completed', temporaryMediaFile: result.temporaryMediaFile })
    }
    return normalizeAsyncPollResult(result)
  },
  cancel: async ({ parsed }) => parsed.type === 'MUSIC'
      ? await cancelComfyUiMusic(parsed.requestId, parsed.endpoint)
      : await cancelComfyUiH3Video(parsed.requestId, parsed.endpoint),
}
