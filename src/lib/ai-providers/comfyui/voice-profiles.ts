import type {
  AiOptionSchema, AiReadonlyUnknownObject, AiResolvedSelection, AiVariantDescriptor, VoiceCapabilities,
} from '@/lib/ai-registry/types'
import {
  VOICE_DESIGN_LANGUAGE_OPTIONS,
  VOICE_DESIGN_TEXT_MAX_CHARS,
  voiceDesignGenerationOptionsSchema,
} from '@/lib/voice/voice-design-contract'
import type { ComfyUiRuntimeTargetId } from './config'
import { freezeComfyUiPromptGraph, type ComfyUiPromptGraph } from './profiles'
import qwenVoiceDesignWorkflow from './workflows/qwen3-tts-voice-design.json'

export const COMFYUI_VOICE_OUTPUT_NODE_ID = '2'

// Public plugin protocol, not proof of the installed Windows version. Runtime object_info
// must match before submission. Source: shinrali/ComfyUI-Qwen3-TTS, nodes.py and
// example_workflows/Qwen3-TTS Voice Design.json @ 7ec281a883bee318d265a6555bd91d488242ec9b.
export const QWEN_VOICE_DESIGN_PROTOCOL_SOURCE =
  'https://github.com/shinrali/ComfyUI-Qwen3-TTS/tree/7ec281a883bee318d265a6555bd91d488242ec9b'

type ComfyUiVoiceGraphInput = {
  readonly prompt: string
  // Already normalized by the execution engine with this profile's optionSchema.
  readonly options: AiReadonlyUnknownObject
  readonly promptId: string
  readonly seed: number
}

export type ComfyUiVoiceProfile = {
  readonly modelId: string
  readonly modelKey: string
  readonly name: string
  readonly runtimeTargetId: ComfyUiRuntimeTargetId
  readonly capabilities: VoiceCapabilities
  readonly workflow: ComfyUiPromptGraph
  readonly outputNodeId: typeof COMFYUI_VOICE_OUTPUT_NODE_ID
  readonly optionSchema: AiOptionSchema
  readonly buildGraph: (input: ComfyUiVoiceGraphInput) => ComfyUiPromptGraph
}

const optionKeys = voiceDesignGenerationOptionsSchema.keyof().options
const voiceOptionSchema: AiOptionSchema = {
  allowedKeys: new Set(optionKeys),
  required: optionKeys,
  validators: {},
  objectValidators: [(options) => voiceDesignGenerationOptionsSchema.safeParse(options).success
    ? { ok: true } : { ok: false, reason: 'voice_design_options_invalid' }],
}

export const QWEN_VOICE_DESIGN_PROFILE: ComfyUiVoiceProfile = {
  modelId: 'qwen3-tts-voice-design-1.7b',
  modelKey: 'comfyui::qwen3-tts-voice-design-1.7b',
  name: 'Qwen3-TTS VoiceDesign 1.7B',
  runtimeTargetId: 'h3-dual-stage-2mp',
  capabilities: {
    useCases: ['voice_design'],
    languageOptions: [...VOICE_DESIGN_LANGUAGE_OPTIONS],
    requiresReferenceAudio: false,
    outputFormatOptions: ['wav'],
    textMaxChars: VOICE_DESIGN_TEXT_MAX_CHARS,
  },
  workflow: freezeComfyUiPromptGraph(qwenVoiceDesignWorkflow),
  outputNodeId: COMFYUI_VOICE_OUTPUT_NODE_ID,
  optionSchema: voiceOptionSchema,
  buildGraph: (input) => {
    const graph: ComfyUiPromptGraph = structuredClone(QWEN_VOICE_DESIGN_PROFILE.workflow)
    const design = graph['1']
    const output = graph[COMFYUI_VOICE_OUTPUT_NODE_ID]
    if (!design || !output) throw new Error('COMFYUI_VOICE_PROFILE_INVALID')
    design.inputs.instruct = input.prompt
    design.inputs.text = input.options.previewText
    design.inputs.language = input.options.language
    design.inputs.seed = input.seed
    // SaveQwen3TTSAudio replaces an existing prefix, so each invocation owns its output path.
    output.inputs.filename_prefix = `waoowaoo/qwen3-tts-voice-design/${input.promptId}`
    return graph
  },
}

export const COMFYUI_VOICE_PROFILES: readonly ComfyUiVoiceProfile[] = [QWEN_VOICE_DESIGN_PROFILE]

export function resolveComfyUiVoiceProfile(selection: AiResolvedSelection): ComfyUiVoiceProfile {
  const profile = COMFYUI_VOICE_PROFILES.find((candidate) => candidate.modelKey === selection.modelKey)
  if (selection.provider !== 'comfyui' || !profile || selection.modelId !== profile.modelId) {
    throw new Error(`COMFYUI_VOICE_MODEL_UNSUPPORTED:${selection.modelKey}`)
  }
  return profile
}

export function describeComfyUiVoice(selection: AiResolvedSelection): AiVariantDescriptor {
  const profile = resolveComfyUiVoiceProfile(selection)
  return {
    modelKey: profile.modelKey, modelId: profile.modelId, providerKey: 'comfyui', providerId: 'comfyui', modality: 'voice',
    display: { name: profile.name, sourceLabel: 'comfyui', label: `${profile.name} (comfyui)` },
    execution: { mode: 'async' }, capabilities: { voice: profile.capabilities }, optionSchema: profile.optionSchema,
  }
}
