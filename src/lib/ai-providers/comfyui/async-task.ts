import type { AsyncTaskProviderRegistration, ParsedAsyncExternalId } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { cancelComfyUiH3Video, pollComfyUiH3Video } from './h3'
import { cancelComfyUiMossSound, pollComfyUiMossSound } from './moss'
import { cancelComfyUiMossTts, pollComfyUiMossTts } from './tts'

function parseComfyUiExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  if (parts.length !== 3 || parts[0] !== 'COMFYUI' || !['VIDEO', 'SOUND', 'VOICE'].includes(parts[1] ?? '') || !/^[0-9a-f-]{36}$/iu.test(parts[2] ?? '')) {
    throw new Error(`Invalid COMFYUI externalId: ${externalId}`)
  }
  return { provider: 'COMFYUI', type: parts[1] as 'VIDEO' | 'SOUND' | 'VOICE', requestId: parts[2]! }
}

export const comfyuiAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'COMFYUI',
  canParseExternalId: (externalId) => externalId.startsWith('COMFYUI:'),
  parseExternalId: parseComfyUiExternalId,
  formatExternalId: (input) => `COMFYUI:${input.type}:${input.requestId}`,
  poll: async ({ parsed }) => {
    const result = parsed.type === 'SOUND'
      ? await pollComfyUiMossSound(parsed.requestId)
      : parsed.type === 'VOICE'
        ? await pollComfyUiMossTts(parsed.requestId)
        : await pollComfyUiH3Video(parsed.requestId)
    if (result.status === 'pending') return normalizeAsyncPollResult(result)
    if (result.status === 'completed') {
      if (parsed.type === 'SOUND' || parsed.type === 'VOICE') {
        if (!('audioUrl' in result)) throw new Error('COMFYUI_SOUND_RESULT_MISSING')
        return normalizeAsyncPollResult({ status: 'completed', resultUrl: result.audioUrl })
      }
      if (!('videoUrl' in result)) throw new Error('COMFYUI_VIDEO_RESULT_MISSING')
      return normalizeAsyncPollResult({ status: 'completed', videoUrl: result.videoUrl })
    }
    return normalizeAsyncPollResult(result)
  },
  cancel: async ({ parsed }) => parsed.type === 'SOUND'
    ? await cancelComfyUiMossSound(parsed.requestId)
    : parsed.type === 'VOICE'
      ? await cancelComfyUiMossTts(parsed.requestId)
      : await cancelComfyUiH3Video(parsed.requestId),
}
