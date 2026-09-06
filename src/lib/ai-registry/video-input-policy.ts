import type { VideoCapabilities, VideoInputMode } from './types'

type VideoInputPolicyCapabilities = {
  readonly supportedInputModes?: readonly VideoInputMode[]
  readonly supportedAspectRatios?: readonly string[]
  readonly inputModePolicies?: Readonly<Partial<Record<VideoInputMode, {
    readonly durationOptions: readonly number[]
  }>>>
}

export type ResolvedVideoInputPolicySelection = {
  readonly inputMode: VideoInputMode
  readonly requestedDurationSeconds: number
  readonly aspectRatio: string
}

export type VideoSourceAspectRatio = {
  readonly width: number
  readonly height: number
}

export function isVideoContinuationSourceAspectRatioSupported(input: {
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly allowedSourceAspectRatios: readonly VideoSourceAspectRatio[]
}): boolean {
  if (
    !Number.isSafeInteger(input.sourceWidth)
    || input.sourceWidth <= 0
    || !Number.isSafeInteger(input.sourceHeight)
    || input.sourceHeight <= 0
  ) return false
  return input.allowedSourceAspectRatios.some((candidate) => (
    Number.isSafeInteger(candidate.width)
    && candidate.width > 0
    && Number.isSafeInteger(candidate.height)
    && candidate.height > 0
    && input.sourceWidth * candidate.height === input.sourceHeight * candidate.width
  ))
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
  if (!input.capabilities.supportedAspectRatios?.includes(input.aspectRatio)) {
    throw new Error(`VIDEO_ASPECT_RATIO_UNSUPPORTED:${input.aspectRatio}`)
  }
  return {
    inputMode: input.inputMode,
    requestedDurationSeconds: input.requestedDurationSeconds,
    aspectRatio: input.aspectRatio,
  }
}
