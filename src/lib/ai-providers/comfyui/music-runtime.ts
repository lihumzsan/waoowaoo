import type { AiProviderMusicExecutionContext, AiProviderPreparedMediaExecution } from '@/lib/ai-providers/runtime-types'
import { prepareComfyUiAudioPrompt } from './audio-runtime'
import { COMFYUI_MUSIC_OUTPUT_NODE_ID, resolveComfyUiMusicProfile } from './music-profiles'

export async function prepareComfyUiMusicGeneration(input: AiProviderMusicExecutionContext): Promise<AiProviderPreparedMediaExecution> {
  const profile = resolveComfyUiMusicProfile(input.selection)
  if (input.generation.kind !== 'prompt') throw new Error('COMFYUI_MUSIC_GENERATION_MODE_INVALID')
  const promptId = crypto.randomUUID()
  const built = profile.buildGraph({
    prompt: input.generation.prompt, options: input.options ?? {},
    seed: Number.parseInt(promptId.replace(/-/gu, '').slice(0, 12), 16),
  })
  const output = built.graph[COMFYUI_MUSIC_OUTPUT_NODE_ID]
  if (profile.outputNodeId !== COMFYUI_MUSIC_OUTPUT_NODE_ID || output?.class_type !== 'SaveAudioAdvanced'
    || output.inputs.format !== 'mp3' || output.inputs['format.quality'] !== 'V0') {
    throw new Error(`COMFYUI_MUSIC_OUTPUT_CONTRACT_INVALID:${profile.modelId}`)
  }
  return await prepareComfyUiAudioPrompt({
    type: 'MUSIC', modelId: profile.modelId, targetId: profile.runtimeTargetId,
    promptId, graph: built.graph, metadata: built.durationPlan,
  })
}
