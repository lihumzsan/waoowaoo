import type { AiProviderPreparedMediaExecution, AiProviderVoiceExecutionContext } from '@/lib/ai-providers/runtime-types'
import { prepareComfyUiAudioPrompt } from './audio-runtime'
import { resolveComfyUiVoiceProfile } from './voice-profiles'

export async function prepareComfyUiVoiceGeneration(input: AiProviderVoiceExecutionContext): Promise<AiProviderPreparedMediaExecution> {
  const profile = resolveComfyUiVoiceProfile(input.selection)
  const promptId = crypto.randomUUID()
  const graph = profile.buildGraph({
    prompt: input.prompt, options: input.options ?? {}, promptId,
    seed: Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16),
  })
  return await prepareComfyUiAudioPrompt({
    type: 'VOICE', modelId: profile.modelId, targetId: profile.runtimeTargetId, promptId, graph,
  })
}
