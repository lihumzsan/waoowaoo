import type { VideoInputMode } from '@/lib/ai-registry/types'

export type VideoInputReference = {
  readonly channel: 'image' | 'audio' | 'video'
  readonly role: string
}
export type VideoInputModeErrorCode =
  | 'VIDEO_REFERENCE_ROLE_INVALID'
  | 'VIDEO_MODEL_FRAME_INPUT_INVALID'
  | 'VIDEO_REFERENCE_MODE_CONFLICT'

export class VideoInputModeError extends Error {
  readonly code: VideoInputModeErrorCode

  constructor(code: VideoInputModeErrorCode) {
    super(code)
    this.name = 'VideoInputModeError'
    this.code = code
  }
}

export type ResolvedVideoInputMode = {
  readonly mode: VideoInputMode
  readonly firstFrameCount: number
  readonly lastFrameCount: number
  readonly referenceImageCount: number
  readonly referenceAudioCount: number
  readonly referenceVideoCount: number
  readonly usesLastFrame: boolean
}

const ROLES_BY_CHANNEL = {
  image: new Set(['first_frame', 'last_frame', 'reference_image']),
  audio: new Set(['reference_audio']),
  video: new Set(['reference_video']),
} satisfies Record<VideoInputReference['channel'], ReadonlySet<string>>

export function resolveVideoInputMode(
  references: readonly VideoInputReference[],
): ResolvedVideoInputMode {
  for (const reference of references) {
    if (!ROLES_BY_CHANNEL[reference.channel].has(reference.role)) {
      throw new VideoInputModeError('VIDEO_REFERENCE_ROLE_INVALID')
    }
  }

  const firstFrameCount = references.filter((reference) => (
    reference.channel === 'image' && reference.role === 'first_frame'
  )).length
  const lastFrameCount = references.filter((reference) => (
    reference.channel === 'image' && reference.role === 'last_frame'
  )).length
  const referenceImageCount = references.filter((reference) => (
    reference.channel === 'image' && reference.role === 'reference_image'
  )).length
  const referenceAudioCount = references.filter((reference) => reference.channel === 'audio').length
  const referenceVideoCount = references.filter((reference) => reference.channel === 'video').length
  const usesFrames = firstFrameCount > 0 || lastFrameCount > 0
  const usesReferences = referenceImageCount > 0 || referenceAudioCount > 0 || referenceVideoCount > 0

  if (usesFrames && usesReferences) {
    throw new VideoInputModeError('VIDEO_REFERENCE_MODE_CONFLICT')
  }
  if (
    usesFrames
    && (
      firstFrameCount !== 1
      || lastFrameCount > 1
    )
  ) {
    throw new VideoInputModeError('VIDEO_MODEL_FRAME_INPUT_INVALID')
  }

  const mode: VideoInputMode = usesFrames
    ? lastFrameCount === 1 ? 'first_last_frame' : 'first_frame'
    : usesReferences ? 'reference' : 'text_to_video'

  return {
    mode,
    firstFrameCount,
    lastFrameCount,
    referenceImageCount,
    referenceAudioCount,
    referenceVideoCount,
    usesLastFrame: lastFrameCount === 1,
  }
}
