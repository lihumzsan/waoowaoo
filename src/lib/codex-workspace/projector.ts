import { prisma } from '@/lib/prisma'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig, type ProjectModelConfig } from '@/lib/config-service'
import {
  validateWorkspaceBundle,
  WORKSPACE_BUNDLE_SCHEMA_VERSION,
} from '@/lib/codex-runtime/workspace-bundle'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/workspace-resource/generation-contract'
import {
  CODEX_WORKSPACE_PROJECT_FILE,
  type CodexWorkspaceProductionCapabilities,
  type CodexWorkspaceProjectSnapshot,
  type CodexWorkspaceProjection,
} from './contracts'

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function productionCapabilities(config: ProjectModelConfig): CodexWorkspaceProductionCapabilities {
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
        supportsTextToVideo: video.supportsTextToVideo === true,
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

export async function readCodexRuntimeWorkspace(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<CodexWorkspaceProjection> {
  const [project, modelConfig] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        name: true,
        description: true,
        videoRatio: true,
        videoResolution: true,
        imageResolution: true,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!project) throw new Error('CODEX_WORKSPACE_PROJECT_NOT_OWNED')
  const snapshot: CodexWorkspaceProjectSnapshot = {
    schemaVersion: 1,
    projectId: project.id,
    name: project.name,
    description: project.description,
    videoRatio: project.videoRatio,
    videoResolution: project.videoResolution,
    imageResolution: project.imageResolution,
    productionCapabilities: productionCapabilities(modelConfig),
    instructions: [
      'This directory is disposable Runtime scratch, not the persistent project resource tree.',
      'system/project.json is a rebuildable read-only capability snapshot; never modify system/.',
      'Use list_resources and get_resource for canonical project data.',
      'Use create_image, create_audio, create_video, or generate_voice for media production.',
      'A Subagent final result remains an in-memory handoff unless the primary Agent explicitly saves a document.',
    ],
  }
  const projectedFiles = [{ path: CODEX_WORKSPACE_PROJECT_FILE, content: formatJson(snapshot) }]
  const runtimeBundle = validateWorkspaceBundle({
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    directories: ['system'],
    files: projectedFiles,
  })
  return { runtimeBundle }
}
