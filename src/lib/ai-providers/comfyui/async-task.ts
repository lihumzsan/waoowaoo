import type { AsyncPollResult, AsyncTaskProviderRegistration } from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { formatComfyUiExternalId, parseComfyUiExternalId, type ComfyUiAsyncType } from './external-id'
import type { ComfyUiRuntimeTargetId } from './config'
import { cancelComfyUiAudio, pollComfyUiAudio } from './audio-runtime'
import { cancelComfyUiH3Video, pollComfyUiH3Video } from './h3'

type ComfyUiAsyncRuntime = {
  readonly poll: (promptId: string, targetId: string | undefined) => Promise<AsyncPollResult>
  readonly cancel: (promptId: string, targetId: string | undefined) => Promise<void>
}

export const COMFYUI_ASYNC_RUNTIMES = {
  VIDEO: { poll: pollComfyUiH3Video, cancel: cancelComfyUiH3Video },
  MUSIC: {
    poll: (promptId, targetId) => pollComfyUiAudio('MUSIC', promptId, targetId),
    cancel: (promptId, targetId) => cancelComfyUiAudio('MUSIC', promptId, targetId),
  },
  VOICE: {
    poll: (promptId, targetId) => pollComfyUiAudio('VOICE', promptId, targetId),
    cancel: (promptId, targetId) => cancelComfyUiAudio('VOICE', promptId, targetId),
  },
} satisfies Record<ComfyUiAsyncType, ComfyUiAsyncRuntime>

function resolveAsyncRuntime(type: string): ComfyUiAsyncRuntime {
  if (!Object.hasOwn(COMFYUI_ASYNC_RUNTIMES, type)) throw new Error(`COMFYUI_ASYNC_TYPE_UNSUPPORTED:${type}`)
  return COMFYUI_ASYNC_RUNTIMES[type as ComfyUiAsyncType]
}

export const comfyuiAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'COMFYUI',
  providerKey: 'comfyui',
  canParseExternalId: (externalId) => externalId.startsWith('COMFYUI:'),
  parseExternalId: parseComfyUiExternalId,
  formatExternalId: (input) => formatComfyUiExternalId({
    targetId: input.endpoint as ComfyUiRuntimeTargetId,
    type: input.type as ComfyUiAsyncType,
    requestId: input.requestId,
  }),
  poll: async ({ parsed }) => normalizeAsyncPollResult(
    await resolveAsyncRuntime(parsed.type).poll(parsed.requestId, parsed.endpoint),
  ),
  cancel: async ({ parsed }) => resolveAsyncRuntime(parsed.type).cancel(parsed.requestId, parsed.endpoint),
}
