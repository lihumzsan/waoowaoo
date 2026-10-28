import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import type { WorkspaceResourceInputRef } from './contracts'
import { resolveWorkspaceResourceInputMedia } from './input-media'
import type { VideoMergeCuePlacement, VideoMergeTimedCueInput } from '@/lib/video-compose/audio-contract'

/** Freeze final placement from the merge request, independently of music generation mode. */
export async function resolveFrozenVideoMergeAudioCues(input: {
  readonly userId: string
  readonly projectId: string
  readonly references: readonly WorkspaceResourceInputRef[]
  readonly musicCues: readonly VideoMergeTimedCueInput[]
  readonly soundCues: readonly VideoMergeTimedCueInput[]
}): Promise<{
  readonly musicCues: readonly VideoMergeCuePlacement[]
  readonly soundCues: readonly VideoMergeCuePlacement[]
}> {
  const audioReferences = input.references.filter((reference) => (
    reference.role === 'bgm_audio' || reference.role === 'sound_effect_audio'
  ))
  if (audioReferences.length !== input.musicCues.length + input.soundCues.length) {
    throw new ApiError('INVALID_PARAMS', { reasonCode: 'VIDEO_MERGE_CUE_REFERENCE_MISMATCH' })
  }
  if (audioReferences.length === 0) return { musicCues: [], soundCues: [] }
  const sourceVideos = input.references.filter((reference) => reference.role === 'source_video')
  const sourceVideo = sourceVideos[0]
  if (!sourceVideo || sourceVideos.length !== 1) {
    throw new ApiError('INVALID_PARAMS', { reasonCode: 'VIDEO_MERGE_TIMELINE_SOURCE_INVALID' })
  }
  const musicReferences = audioReferences.filter((reference) => reference.role === 'bgm_audio')
  const [[timeline], audioMedia, lineage] = await Promise.all([
    resolveWorkspaceResourceInputMedia({
      userId: input.userId,
      projectId: input.projectId,
      references: [sourceVideo],
      expectedMediaType: 'video',
    }),
    resolveWorkspaceResourceInputMedia({
      userId: input.userId,
      projectId: input.projectId,
      references: audioReferences,
      expectedMediaType: 'audio',
    }),
    musicReferences.length === 0 ? [] : prisma.workspaceResourceLineage.findMany({
      where: {
        role: 'score_timeline',
        OR: musicReferences.map((reference) => ({
          outputResourceId: reference.resourceId,
          outputVersion: reference.contentVersion,
        })),
      },
      select: {
        outputResourceId: true,
        outputVersion: true,
        inputResourceId: true,
        inputVersion: true,
      },
    }),
  ])
  if (!timeline || timeline.durationMs === null || timeline.durationMs <= 0) {
    throw new ApiError('INVALID_PARAMS', { reasonCode: 'VIDEO_MERGE_TIMELINE_DURATION_MISSING' })
  }
  const musicCues: VideoMergeCuePlacement[] = []
  const soundCues: VideoMergeCuePlacement[] = []
  for (const media of audioMedia) {
    const reference = media.reference
    const candidates = reference.role === 'bgm_audio' ? input.musicCues : input.soundCues
    const cue = candidates.find((candidate) => (
      candidate.resourceId === reference.resourceId && candidate.contentVersion === reference.contentVersion
    ))
    const identity = { resourceId: reference.resourceId, contentVersion: reference.contentVersion }
    if (!cue) {
      throw new ApiError('INVALID_PARAMS', { reasonCode: 'VIDEO_MERGE_CUE_MISSING', ...identity })
    }
    if (reference.role === 'bgm_audio') {
      const timelines = lineage.filter((candidate) => (
        candidate.outputResourceId === reference.resourceId && candidate.outputVersion === reference.contentVersion
      ))
      if (
        timelines.length !== 1
        || timelines[0].inputResourceId !== sourceVideo.resourceId
        || timelines[0].inputVersion !== sourceVideo.contentVersion
      ) {
        throw new ApiError('INVALID_PARAMS', { reasonCode: 'VIDEO_MERGE_SCORE_TIMELINE_MISMATCH', ...identity })
      }
    }
    if (media.durationMs === null || media.durationMs <= 0) {
      throw new ApiError('INVALID_PARAMS', { reasonCode: 'VIDEO_MERGE_CUE_DURATION_MISSING', ...identity })
    }
    if (cue.durationMs > media.durationMs) {
      throw new ApiError('INVALID_PARAMS', {
        reasonCode: 'VIDEO_MERGE_CUE_EXCEEDS_SOURCE', ...identity, sourceDurationMs: media.durationMs,
      })
    }
    if (cue.startMs + cue.durationMs > timeline.durationMs) {
      throw new ApiError('INVALID_PARAMS', {
        reasonCode: 'VIDEO_MERGE_CUE_EXCEEDS_TIMELINE', ...identity, timelineDurationMs: timeline.durationMs,
      })
    }
    const placement = {
      inputPosition: reference.position,
      startMs: cue.startMs,
      durationMs: cue.durationMs,
      fadeInMs: cue.fadeInMs,
      fadeOutMs: cue.fadeOutMs,
      gainDb: cue.gainDb,
    }
    if (reference.role === 'bgm_audio') musicCues.push(placement)
    else soundCues.push(placement)
  }
  return { musicCues, soundCues }
}
