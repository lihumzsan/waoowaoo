import { prisma } from '@/lib/prisma'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { getProjectModelConfig, type ProjectModelConfig } from '@/lib/config-service'
import {
  validateWorkspaceBundle,
  WORKSPACE_BUNDLE_SCHEMA_VERSION,
  type WorkspaceBundleFile,
} from '@/lib/codex-runtime/workspace-bundle'
import { encodeEditableResourceFile, encodeMediaPointer } from '@/lib/workspace-resource/file-format'
import { listAllWorkspaceResourcesForRuntime } from '@/lib/workspace-resource/view-service'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/workspace-resource/generation-contract'
import {
  CODEX_WORKSPACE_PROJECT_FILE,
  CodexWorkspaceError,
  type CodexWorkspaceBaselineResource,
  type CodexWorkspaceProductionCapabilities,
  type CodexWorkspaceProjectSnapshot,
  type CodexWorkspaceProjection,
} from './contracts'

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function resourceFile(resource: WorkspaceResourceView): WorkspaceBundleFile {
  if (resource.resourceKind !== 'file' || !resource.mediaType) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
      `Only file Resources can be projected as files: ${resource.resourceId}`,
    )
  }
  if (resource.mediaType !== 'text') {
    return { path: resource.workspacePath, content: encodeMediaPointer(resource) }
  }
  let content = ''
  const currentContent = resource.current?.content ?? null
  if (currentContent?.kind === 'text') content = currentContent.text
  if (currentContent?.kind === 'structured') content = formatJson(currentContent.data)
  if (currentContent?.kind === 'media') {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
      `Text Resource has media content: ${resource.resourceId}`,
    )
  }
  return {
    path: resource.workspacePath,
    content: encodeEditableResourceFile({
      resourceId: resource.resourceId,
      workspacePath: resource.workspacePath,
      content,
    }),
  }
}

function explicitDirectories(input: {
  readonly folderPaths: readonly string[]
  readonly filePaths: readonly string[]
}): string[] {
  const directories = new Set<string>(input.folderPaths)
  for (const filePath of input.filePaths) {
    const segments = filePath.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }
  return [...directories].sort((left, right) => left.localeCompare(right))
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
  const [project, resources, modelConfig] = await Promise.all([
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
    listAllWorkspaceResourcesForRuntime(input),
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
      'Project files outside system/ are the creative workspace and may be organized freely.',
      'system/ is read-only projected context. Never create, edit, move, or delete files there.',
      'Media .resource files are system-owned pointers. Move or delete them; never edit their contents.',
      'Paid creative production is submitted through a professional Subagent-authored Production Manifest.',
    ],
  }
  const fileResources = resources.filter((resource) => resource.resourceKind === 'file')
  const folderResources = resources.filter((resource) => resource.resourceKind === 'folder')
  const resourceFiles = fileResources.map(resourceFile)
  const projectedFiles = [
    ...resourceFiles,
    { path: CODEX_WORKSPACE_PROJECT_FILE, content: formatJson(snapshot) },
  ]
  const runtimeBundle = validateWorkspaceBundle({
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    directories: explicitDirectories({
      folderPaths: folderResources.map((resource) => resource.workspacePath),
      filePaths: projectedFiles.map((file) => file.path),
    }),
    files: projectedFiles,
  })
  const fileContentById = new Map(fileResources.map((resource, index) => [
    resource.resourceId,
    resourceFiles[index]?.content ?? '',
  ]))
  const baselineResources: CodexWorkspaceBaselineResource[] = resources.map((resource) => ({
    resourceId: resource.resourceId,
    schemaId: resource.schemaId,
    workspacePath: resource.workspacePath,
    resourceKind: resource.resourceKind,
    mediaType: resource.mediaType,
    contentVersion: resource.contentVersion,
    fileContent: fileContentById.get(resource.resourceId) ?? null,
    runtimeIdentity: null,
  }))
  return {
    runtimeBundle,
    baseline: { schemaVersion: 1, resources: baselineResources },
  }
}
