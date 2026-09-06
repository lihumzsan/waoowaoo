import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import type { ComfyUiPromptGraph } from './profiles'

const OPTION_INPUT_NAMES_BY_CLASS = {
  UNETLoader: ['unet_name'],
  CLIPLoader: ['clip_name'],
  VAELoader: ['vae_name'],
  LoraLoaderModelOnly: ['lora_name'],
  LoraLoaderBypassModelOnly: ['lora_name'],
  MiniMaxH3LearnedLatentUpscaleT8Advanced: ['model_name'],
  ImageResizeKJv2: ['upscale_method'],
  ModelAttentionBackend: ['attention'],
} as const satisfies Readonly<Record<string, readonly string[]>>

export type ComfyUiProfileRequirementOption = {
  readonly classType: string
  readonly inputName: string
  readonly value: string
}

export type ComfyUiProfileRequirements = {
  readonly nodeClasses: readonly string[]
  readonly options: readonly ComfyUiProfileRequirementOption[]
  readonly fingerprint: string
}

export function deriveComfyUiProfileRequirements(input: {
  readonly profileId: string
  readonly graph: ComfyUiPromptGraph
}): ComfyUiProfileRequirements {
  const nodeClasses = Array.from(new Set(
    Object.values(input.graph).map((node) => node.class_type),
  )).sort()
  const optionByIdentity = new Map<string, ComfyUiProfileRequirementOption>()

  for (const node of Object.values(input.graph)) {
    const inputNames = OPTION_INPUT_NAMES_BY_CLASS[
      node.class_type as keyof typeof OPTION_INPUT_NAMES_BY_CLASS
    ]
    if (!inputNames) continue
    for (const inputName of inputNames) {
      const value = node.inputs[inputName]
      if (typeof value !== 'string' || !value.trim()) continue
      const option = {
        classType: node.class_type,
        inputName,
        value,
      }
      optionByIdentity.set(
        [option.classType, option.inputName, option.value].join('\u0000'),
        option,
      )
    }
  }

  const options = Array.from(optionByIdentity.values()).sort((left, right) => (
    left.classType.localeCompare(right.classType)
    || left.inputName.localeCompare(right.inputName)
    || left.value.localeCompare(right.value)
  ))

  return {
    nodeClasses,
    options,
    fingerprint: hashCanonicalJson({
      profileId: input.profileId,
      graph: input.graph,
    }),
  }
}
