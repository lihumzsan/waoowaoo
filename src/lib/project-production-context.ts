import { createHash } from 'node:crypto'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig, type ProjectModelConfig } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/workspace-resource/generation-contract'
import type { VideoInputMode } from '@/lib/ai-registry/types'

export type ProjectProductionCapabilities = {
  readonly video: {
    readonly modelKey: string
    readonly aspectRatio: string
    readonly allowedSegmentDurationsSeconds: readonly number[]
    readonly minSegmentDurationSeconds: number
    readonly maxSegmentDurationSeconds: number
    readonly maxReferenceImages: number
    readonly maxReferenceAudios: number
    readonly maxReferenceVideos: number
    readonly maxReferenceFiles: number
    readonly referenceAudioRequiresVisual: boolean
    readonly supportedInputModes: readonly VideoInputMode[]
  } | null
  readonly music: {
    readonly modelKey: string
    readonly promptMaxCharacters: number
    readonly durationSecondsOptions: readonly number[]
    readonly durationSecondsRange: {
      readonly min: number
      readonly max: number
    } | null
    readonly vocalModeOptions: readonly string[]
    readonly maxReferenceVideos: number
  } | null
}

export type ProjectProductionContext = {
  readonly schemaVersion: 2
  readonly version: string
  readonly project: {
    readonly projectId: string
    readonly name: string
    readonly description: string | null
    readonly videoRatio: string | null
    readonly videoResolution: string
    readonly imageResolution: string
  }
  readonly productionCapabilities: ProjectProductionCapabilities
}

export class ProjectProductionContextError extends Error {
  constructor() {
    super('PROJECT_PRODUCTION_CONTEXT_NOT_OWNED')
    this.name = 'ProjectProductionContextError'
  }
}

function resolveProductionCapabilities(config: ProjectModelConfig): ProjectProductionCapabilities {
  const video = config.videoModel
    ? resolveBuiltinCapabilitiesByModelKey('video', config.videoModel)?.video
    : undefined
  const allowedSegmentDurationsSeconds = Array.from(new Set(
    (video?.durationOptions ?? []).filter((duration): duration is number => (
      Number.isInteger(duration)
      && duration > 0
      && duration <= CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS
    )),
  )).sort((left, right) => left - right)
  const minSegmentDurationSeconds = allowedSegmentDurationsSeconds[0]
  const maxSegmentDurationSeconds = allowedSegmentDurationsSeconds.at(-1)
  const videoCapabilities = config.videoModel
    && config.videoRatio
    && video
    && minSegmentDurationSeconds !== undefined
    && maxSegmentDurationSeconds !== undefined
    ? {
        modelKey: config.videoModel,
        aspectRatio: config.videoRatio,
        allowedSegmentDurationsSeconds,
        minSegmentDurationSeconds,
        maxSegmentDurationSeconds,
        maxReferenceImages: video.maxReferenceImages ?? 1,
        maxReferenceAudios: video.maxReferenceAudios ?? 0,
        maxReferenceVideos: video.maxReferenceVideos ?? 0,
        maxReferenceFiles: video.maxReferenceFiles ?? 0,
        referenceAudioRequiresVisual: video.referenceAudioRequiresVisual === true,
        supportedInputModes: video.supportedInputModes ?? [],
      }
    : null

  const music = config.musicModel
    ? resolveBuiltinCapabilitiesByModelKey('music', config.musicModel)?.music
    : undefined
  const durationSecondsRange = music?.durationSecondsRange
    ? {
        min: Math.ceil(music.durationSecondsRange.min),
        max: Math.floor(music.durationSecondsRange.max),
      }
    : null
  const durationSecondsOptions = Array.from(new Set(
    (music?.durationSecondsOptions ?? []).filter((duration): duration is number => (
      Number.isInteger(duration) && duration > 0
    )),
  )).sort((left, right) => left - right)
  const musicCapabilities = config.musicModel
    && music
    && (durationSecondsRange !== null || durationSecondsOptions.length > 0)
    ? {
        modelKey: config.musicModel,
        promptMaxCharacters: Math.min(music.promptMaxChars ?? 100_000, 100_000),
        durationSecondsOptions,
        durationSecondsRange,
        vocalModeOptions: music.vocalModeOptions ?? [],
        maxReferenceVideos: music.maxReferenceVideos ?? 0,
      }
    : null

  return { video: videoCapabilities, music: musicCapabilities }
}

function contextVersion(value: Omit<ProjectProductionContext, 'version'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function readProjectProductionContext(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<ProjectProductionContext> {
  const [project, modelConfig] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        name: true,
        description: true,
        videoResolution: true,
        imageResolution: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!project) throw new ProjectProductionContextError()
  const value: Omit<ProjectProductionContext, 'version'> = {
    schemaVersion: 2,
    project: {
      projectId: project.id,
      name: project.name,
      description: project.description,
      videoRatio: modelConfig.videoRatio,
      videoResolution: project.videoResolution,
      imageResolution: project.imageResolution,
    },
    productionCapabilities: resolveProductionCapabilities(modelConfig),
  }
  return { ...value, version: contextVersion(value) }
}

export function formatProjectProductionContext(context: ProjectProductionContext): string {
  return JSON.stringify(context, null, 2)
}
