import { createHash } from 'node:crypto'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig, type ProjectModelConfig } from '@/lib/config-service'
import { prisma } from '@/lib/prisma'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/workspace-resource/generation-contract'
import type { VideoInputMode } from '@/lib/ai-registry/types'
import { readOwnedProjectProductionProfile } from '@/lib/production-profile'
import type { ProductionProfileId } from '@/lib/production-profile/types'

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
    readonly minReferenceAudioDurationMs: number | null
    readonly maxTotalReferenceAudioDurationMs: number | null
    readonly supportedInputModes: readonly VideoInputMode[]
  } | null
  readonly music: {
    readonly modelKey: string
    readonly generationMode: 'composition_plan'
    readonly maxChunks: number
    readonly minChunkDurationMs: number
    readonly maxChunkDurationMs: number
    readonly minPlanDurationMs: number
    readonly maxPlanDurationMs: number
    readonly maxPositiveStyles: number
    readonly maxNegativeStyles: number
    readonly contextAdherenceOptions: readonly ('low' | 'medium' | 'high')[]
  } | null
}

export type ProjectProductionContext = {
  readonly schemaVersion: 5
  readonly version: string
  readonly project: {
    readonly projectId: string
    readonly name: string
    readonly description: string | null
    readonly videoRatio: string | null
    readonly videoResolution: string
    readonly imageResolution: string
  }
  readonly productionProfile: {
    readonly id: ProductionProfileId
    readonly version: number
    readonly purpose: string
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
        minReferenceAudioDurationMs: video.minReferenceAudioDurationMs ?? null,
        maxTotalReferenceAudioDurationMs: video.maxTotalReferenceAudioDurationMs ?? null,
        supportedInputModes: video.supportedInputModes ?? [],
      }
    : null

  const music = config.musicModel
    ? resolveBuiltinCapabilitiesByModelKey('music', config.musicModel)?.music
    : undefined
  const compositionPlan = music?.compositionPlan
  const musicCapabilities = config.musicModel
    && music?.generationModes?.includes('composition_plan')
    && compositionPlan
      ? {
        modelKey: config.musicModel,
        generationMode: 'composition_plan' as const,
        maxChunks: compositionPlan.maxChunks,
        minChunkDurationMs: compositionPlan.minChunkDurationMs,
        maxChunkDurationMs: compositionPlan.maxChunkDurationMs,
        minPlanDurationMs: compositionPlan.minPlanDurationMs,
        maxPlanDurationMs: compositionPlan.maxPlanDurationMs,
        maxPositiveStyles: compositionPlan.maxPositiveStyles,
        maxNegativeStyles: compositionPlan.maxNegativeStyles,
        contextAdherenceOptions: compositionPlan.contextAdherenceOptions,
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
  const [project, modelConfig, productionProfile] = await Promise.all([
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
    readOwnedProjectProductionProfile(input),
  ])
  if (!project) throw new ProjectProductionContextError()
  const value: Omit<ProjectProductionContext, 'version'> = {
    schemaVersion: 5,
    project: {
      projectId: project.id,
      name: project.name,
      description: project.description,
      videoRatio: modelConfig.videoRatio,
      videoResolution: project.videoResolution,
      imageResolution: project.imageResolution,
    },
    productionProfile: {
      id: productionProfile.id,
      version: productionProfile.version,
      purpose: productionProfile.purpose,
    },
    productionCapabilities: resolveProductionCapabilities(modelConfig),
  }
  return { ...value, version: contextVersion(value) }
}

export function formatProjectProductionContext(context: ProjectProductionContext): string {
  return JSON.stringify(context, null, 2)
}
