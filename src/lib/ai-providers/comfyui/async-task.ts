import type { AsyncTaskProviderRegistration } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { formatComfyUiExternalId, parseComfyUiExternalId } from './external-id'
import { cancelComfyUiAceStepMusic, pollComfyUiAceStepMusic } from './ace-step'
import { cancelComfyUiH3Video, pollComfyUiH3Video } from './h3'
import { cancelComfyUiMossSound, pollComfyUiMossSound } from './moss'
import { cancelComfyUiMossTts, pollComfyUiMossTts } from './tts'

export const comfyuiAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'COMFYUI',
  providerKey: 'comfyui',
  canParseExternalId: (externalId) => externalId.startsWith('COMFYUI:'),
  parseExternalId: parseComfyUiExternalId,
  formatExternalId: (input) => formatComfyUiExternalId({
    targetId: input.endpoint as 'shared' | 'h3-dual-stage-2mp',
    type: input.type as 'VIDEO' | 'MUSIC' | 'SOUND' | 'VOICE',
    requestId: input.requestId,
  }),
  poll: async ({ parsed }) => {
    const result = parsed.type === 'SOUND'
      ? await pollComfyUiMossSound(parsed.requestId, parsed.endpoint)
      : parsed.type === 'MUSIC'
        ? await pollComfyUiAceStepMusic(parsed.requestId, parsed.endpoint)
        : parsed.type === 'VOICE'
          ? await pollComfyUiMossTts(parsed.requestId, parsed.endpoint)
          : await pollComfyUiH3Video(parsed.requestId, parsed.endpoint)
    if (result.status === 'pending') return normalizeAsyncPollResult(result)
    if (result.status === 'completed') {
      if (parsed.type === 'SOUND' || parsed.type === 'MUSIC' || parsed.type === 'VOICE') {
        if (!('audioUrl' in result)) throw new Error(`COMFYUI_${parsed.type}_RESULT_MISSING`)
        return normalizeAsyncPollResult({ status: 'completed', resultUrl: result.audioUrl })
      }
      if (!('temporaryMediaFile' in result)) throw new Error('COMFYUI_VIDEO_RESULT_MISSING')
      return normalizeAsyncPollResult({ status: 'completed', temporaryMediaFile: result.temporaryMediaFile })
    }
    return normalizeAsyncPollResult(result)
  },
  cancel: async ({ parsed }) => parsed.type === 'SOUND'
    ? await cancelComfyUiMossSound(parsed.requestId, parsed.endpoint)
    : parsed.type === 'MUSIC'
      ? await cancelComfyUiAceStepMusic(parsed.requestId, parsed.endpoint)
      : parsed.type === 'VOICE'
        ? await cancelComfyUiMossTts(parsed.requestId, parsed.endpoint)
        : await cancelComfyUiH3Video(parsed.requestId, parsed.endpoint),
}
