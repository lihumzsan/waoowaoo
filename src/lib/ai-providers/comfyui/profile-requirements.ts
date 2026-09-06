import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import type { ComfyUiPromptGraph } from './profiles'
import type { ComfyUiInputSchemaLocation } from './transport'

const REQUIRED_OPTION_INPUT_NAMES_BY_CLASS = {
  UNETLoader: ['unet_name'],
  CLIPLoader: ['clip_name'],
  VAELoader: ['vae_name'],
  LoraLoaderModelOnly: ['lora_name'],
  LoraLoaderBypassModelOnly: ['lora_name'],
  MiniMaxH3LearnedLatentUpscaleT8Advanced: [
    'model_name',
    'size_mode',
    'aspect_policy',
    'precision',
    'release_policy',
  ],
  ImageResizeKJv2: ['upscale_method'],
  ModelAttentionBackend: ['attention'],
} as const satisfies Readonly<Record<string, readonly string[]>>

type ComfyUiProfileRequirementInput = {
  readonly inputName: string
  readonly location: ComfyUiInputSchemaLocation
}

function readOptionInputs(classType: string): readonly ComfyUiProfileRequirementInput[] {
  const commonRequired = REQUIRED_OPTION_INPUT_NAMES_BY_CLASS[
    classType as keyof typeof REQUIRED_OPTION_INPUT_NAMES_BY_CLASS
  ] ?? []
  return commonRequired.map((inputName) => ({
    inputName,
    location: 'required' as const,
  }))
}

export type ComfyUiProfileRequirementOption = {
  readonly classType: string
  readonly inputName: string
  readonly location: ComfyUiInputSchemaLocation
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
    const optionInputs = readOptionInputs(node.class_type)
    for (const { inputName, location } of optionInputs) {
      const value = node.inputs[inputName]
      if (typeof value !== 'string' || !value.trim()) continue
      const option = {
        classType: node.class_type,
        inputName,
        location,
        value,
      }
      optionByIdentity.set(
        [option.classType, option.inputName, option.location, option.value].join('\u0000'),
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
