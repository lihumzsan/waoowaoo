import type { VideoCapabilities, VideoInputMode } from './types'

type VideoInputPolicyCapabilities = {
  readonly supportedInputModes?: readonly VideoInputMode[]
  readonly aspectRatioOptions?: readonly string[]
  readonly inputModePolicies?: Readonly<Partial<Record<VideoInputMode, {
    readonly durationOptions: readonly number[]
  }>>>
}

export type ResolvedVideoInputPolicySelection = {
  readonly inputMode: VideoInputMode
  readonly requestedDurationSeconds: number
  readonly aspectRatio: string
}

export function resolveVideoInputPolicySelection(input: {
  readonly capabilities: VideoCapabilities | VideoInputPolicyCapabilities
  readonly inputMode: VideoInputMode
  readonly requestedDurationSeconds: number
  readonly aspectRatio: string
}): ResolvedVideoInputPolicySelection {
  if (!input.capabilities.supportedInputModes?.includes(input.inputMode)) {
    throw new Error(`VIDEO_INPUT_MODE_UNSUPPORTED:${input.inputMode}`)
  }
  const policy = input.capabilities.inputModePolicies?.[input.inputMode]
  if (!policy) throw new Error(`VIDEO_INPUT_MODE_POLICY_MISSING:${input.inputMode}`)
  if (!policy.durationOptions.includes(input.requestedDurationSeconds)) {
    throw new Error(`VIDEO_INPUT_MODE_DURATION_UNSUPPORTED:${input.inputMode}:${String(input.requestedDurationSeconds)}`)
  }
  if (!input.capabilities.aspectRatioOptions?.includes(input.aspectRatio)) {
    throw new Error(`VIDEO_ASPECT_RATIO_UNSUPPORTED:${input.aspectRatio}`)
  }
  return {
    inputMode: input.inputMode,
    requestedDurationSeconds: input.requestedDurationSeconds,
    aspectRatio: input.aspectRatio,
  }
}
