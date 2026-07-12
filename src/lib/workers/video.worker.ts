import { Worker, type Job } from 'bullmq'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { getTaskDefinitionForQueue, type VideoTaskHandlerKey } from '@/lib/task/definition'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import { getWorkerConcurrency } from './runtime-config'
import {
  assertTaskActive,
  getProjectModels,
  resolveVideoSourceFromGeneration,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
} from './utils'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { supportsAssetReferenceMultiReferenceVideoModel } from '@/lib/ai-registry/video-model-helpers'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { handleFinalVideoRenderTask } from './final-video-render'
import { handleChapterRenderTask } from './chapter-render'
import { resolveVideoGroupShots, totalVideoGroupDuration, validateVideoGroupShotIds } from '@/lib/video-groups/core'
import type { VideoGridMode, VideoGroupShot } from '@/lib/video-groups/types'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type PanelRecord = NonNullable<Awaited<ReturnType<typeof prisma.projectPanel.findUnique>>>

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractGenerationOptions(payload: AnyObj): VideoOptionMap {
  const fromEnvelope = payload.generationOptions
  if (!fromEnvelope || typeof fromEnvelope !== 'object' || Array.isArray(fromEnvelope)) {
    return {}
  }

  const next: VideoOptionMap = {}
  for (const [key, value] of Object.entries(fromEnvelope as Record<string, unknown>)) {
    if (key === 'aspectRatio') continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value
    }
  }
  return next
}

function toPersistedVideoGenerationOptions(options: VideoOptionMap): VideoOptionMap | typeof Prisma.DbNull {
  const persisted: VideoOptionMap = {}
  for (const [key, value] of Object.entries(options)) {
    if (key === 'aspectRatio' || key === 'generationMode' || key === 'duration') continue
    persisted[key] = value
  }
  return Object.keys(persisted).length > 0 ? persisted : Prisma.DbNull
}

function requirePanelVideoDurationSec(panel: PanelRecord): number {
  if (
    typeof panel.duration !== 'number' ||
    !Number.isFinite(panel.duration) ||
    !Number.isInteger(panel.duration) ||
    panel.duration <= 0
  ) {
    throw new Error(`VIDEO_PANEL_DURATION_REQUIRED:${panel.id}`)
  }
  return panel.duration
}

async function fetchPanelByStoryboardIndex(storyboardId: string, panelIndex: number) {
  return await prisma.projectPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
    },
  })
}

async function getPanelForVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj

  // 优先使用 targetType=ProjectPanel 直接定位
  if (job.data.targetType === 'ProjectPanel') {
    const panel = await prisma.projectPanel.findUnique({ where: { id: job.data.targetId } })
    if (!panel) throw new Error('Panel not found')
    return panel
  }

  // 兜底：通过 storyboardId + panelIndex 定位
  const storyboardId = payload.storyboardId
  const panelIndex = payload.panelIndex
  if (typeof storyboardId !== 'string' || !storyboardId || panelIndex === undefined || panelIndex === null) {
    throw new Error('Missing storyboardId/panelIndex for video task')
  }

  const panel = await fetchPanelByStoryboardIndex(storyboardId, Number(panelIndex))
  if (!panel) throw new Error('Panel not found by storyboardId/panelIndex')
  return panel
}

async function generateVideoForPanel(
  job: Job<TaskJobData>,
  panel: PanelRecord,
  payload: AnyObj,
  modelId: string,
  projectVideoRatio: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<{ cosKey: string; actualVideoTokens?: number }> {
  if (!panel.imageUrl) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }

  const customPrompt = typeof payload.customPrompt === 'string' ? payload.customPrompt : null
  const prompt = customPrompt || panel.videoPrompt
  if (!prompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }
  const generationPrompt = prompt

  const sourceImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!sourceImageUrl) {
    throw new Error(`Panel ${panel.id} image url invalid`)
  }
  const sourceImageBase64 = await normalizeToBase64ForGeneration(sourceImageUrl)

  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  const durationSec = requirePanelVideoDurationSec(panel)
  const model = modelId

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    referenceImages: [
      { url: sourceImageBase64, role: 'reference', order: 1, source: 'storyboard' },
    ],
    options: {
      prompt: generationPrompt,
      ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
      ...generationOptions,
      duration: durationSec,
      generationMode: 'normal',
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
    },
  })

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(model)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  const cosKey = await uploadVideoSourceToCos(
    videoSource,
    'panel-video',
    panel.id,
    downloadHeaders,
    { taskId: job.data.taskId, artifact: `panel-video:${panel.id}` },
  )
  return {
    cosKey,
    ...(typeof generatedVideo.actualVideoTokens === 'number'
      ? { actualVideoTokens: generatedVideo.actualVideoTokens }
      : {}),
  }
}

async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const modelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const panel = await getPanelForVideoTask(job)

  const generationOptions = extractGenerationOptions(payload)

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const { cosKey, actualVideoTokens } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio || null,
    generationOptions,
  )

  await assertTaskActive(job, 'persist_panel_video')
  await prisma.projectPanel.update({
    where: { id: panel.id },
    data: {
      videoUrl: cosKey,
      lastVideoGenerationOptions: toPersistedVideoGenerationOptions(generationOptions),
    },
  })

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    ...(typeof actualVideoTokens === 'number' ? { actualVideoTokens } : {}),
  }
}

function parseShotIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('VIDEO_GROUP_SHOT_IDS_REQUIRED')
  const shotIds = value.map((item) => (typeof item === 'string' ? item.trim() : ''))
  if (shotIds.some((item) => item.length === 0)) {
    throw new Error('VIDEO_GROUP_SHOT_IDS_INVALID')
  }
  return shotIds
}

function parseReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('ASSET_REFERENCE_VIDEO_IMAGES_REQUIRED')
  const urls = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
  if (urls.length === 0) throw new Error('ASSET_REFERENCE_VIDEO_IMAGES_REQUIRED')
  if (urls.length > 8) throw new Error(`ASSET_REFERENCE_VIDEO_IMAGE_COUNT_UNSUPPORTED:${urls.length}`)
  return urls
}

function validateAssetReferenceShotIds(value: unknown): string[] {
  const shotIds = parseShotIds(value)
  if (shotIds.length < 1 || shotIds.length > 9) {
    throw new Error(`ASSET_REFERENCE_VIDEO_SHOT_COUNT_UNSUPPORTED:${shotIds.length}`)
  }
  return shotIds
}

function parseEditScriptShots(value: unknown): VideoGroupShot[] {
  if (!Array.isArray(value)) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOTS_INVALID')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_INVALID')
    }
    const record = item as Record<string, unknown>
    const shotId = normalizeString(record.shotId)
    const shotNumber = Number(record.shotNumber)
    const durationSec = Number(record.durationSec)
    if (!shotId) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_ID_INVALID')
    if (!Number.isInteger(shotNumber) || shotNumber <= 0) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_NUMBER_INVALID')
    if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 5) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_DURATION_INVALID')
    if (!Array.isArray(record.dialogue)) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_DIALOGUE_INVALID')
    const characters = Array.isArray(record.characters)
      ? record.characters.map((character) => (
          isJsonRecord(character)
            ? {
                id: normalizeString(character.characterId),
                name: normalizeString(character.name),
              }
            : null
        )).filter((character): character is { readonly id: string; readonly name: string } => Boolean(character?.name))
      : []
    const characterNameById = new Map(characters.map((character) => [character.id, character.name]))
    return {
      shotId,
      shotNumber,
      durationSec,
      action: normalizeString(record.action),
      sceneName: isJsonRecord(record.scene) ? normalizeString(record.scene.name) : '',
      characters: characters.map((character) => character.name),
      dialogue: record.dialogue.map((line) => {
        if (!isJsonRecord(line)) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_DIALOGUE_LINE_INVALID')
        const characterId = normalizeString(line.characterId)
        const dialogueLine = normalizeString(line.line)
        if (!characterId || !dialogueLine) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_SHOT_DIALOGUE_LINE_INVALID')
        const speaker = characterNameById.get(characterId)
        if (!speaker) throw new Error(`VIDEO_GROUP_EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shotNumber}:${characterId}`)
        return `${speaker}: ${dialogueLine}`
      }),
      sound: normalizeString(record.sound),
    }
  })
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function requireProjectVideoGroupPrompt(groupId: string): Promise<string> {
  const group = await prisma.projectVideoGroup.findUnique({
    where: { id: groupId },
    select: { prompt: true },
  })
  if (!group) throw new Error(`VIDEO_GROUP_NOT_FOUND:${groupId}`)
  const prompt = normalizeString(group.prompt)
  if (!prompt) throw new Error(`VIDEO_GROUP_PROMPT_MISSING:${groupId}`)
  return prompt
}

function buildAssetReferencePrompt(params: {
  readonly prompt: string
  readonly referenceImageCount: number
}): string {
  return [
    'Use the provided reference asset image(s) as fixed visual references for character identity, location design, props, wardrobe, color, and style. Generate one full-screen continuous video, not a collage, not a grid, and not a split-screen.',
    `Reference asset image count: ${params.referenceImageCount}.`,
    params.prompt,
  ].join('\n\n')
}

function supportsAssetReferenceMultiReference(modelId: string): boolean {
  return supportsAssetReferenceMultiReferenceVideoModel(modelId)
}

async function readCompletedVideoGroupForTask(params: {
  readonly groupId: string
  readonly taskId: string
  readonly episodeId: string
  readonly sourceMode: 'asset_reference' | 'panel_grid'
}) {
  const group = await prisma.projectVideoGroup.findFirst({
    where: { id: params.groupId, taskId: params.taskId, status: 'completed' },
  })
  if (!group || !group.videoUrl || !group.videoMediaId) return null
  if (!Array.isArray(group.shotIds) || !group.shotIds.every((value) => typeof value === 'string' && Boolean(value.trim()))) {
    throw new Error(`VIDEO_GROUP_COMPLETED_SHOT_IDS_INVALID:${group.id}`)
  }
  if (!Array.isArray(group.shotNumbers) || !group.shotNumbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`VIDEO_GROUP_COMPLETED_SHOT_NUMBERS_INVALID:${group.id}`)
  }
  if (typeof group.durationSec !== 'number' || !Number.isFinite(group.durationSec) || group.durationSec <= 0) {
    throw new Error(`VIDEO_GROUP_COMPLETED_DURATION_INVALID:${group.id}`)
  }
  return {
    episodeId: params.episodeId,
    groupId: group.id,
    videoUrl: group.videoUrl,
    videoMediaId: group.videoMediaId,
    referenceImageUrl: group.referenceImageUrl,
    durationSec: group.durationSec,
    shotIds: group.shotIds as string[],
    shotNumbers: group.shotNumbers as number[],
    sourceMode: params.sourceMode,
  }
}

async function handleAssetReferenceVideoGroupTask(params: {
  readonly job: Job<TaskJobData>
  readonly payload: AnyObj
  readonly groupId: string
  readonly modelId: string
  readonly generationOptions: VideoOptionMap
}) {
  const { job, payload, groupId, modelId, generationOptions } = params
  const episodeId = job.data.episodeId || normalizeString(payload.episodeId)
  const chapterId = normalizeString(payload.chapterId)
  if (!episodeId) throw new Error('ASSET_REFERENCE_VIDEO_EPISODE_REQUIRED')
  if (!chapterId) throw new Error('ASSET_REFERENCE_VIDEO_CHAPTER_REQUIRED')
  const replayedCompletion = await readCompletedVideoGroupForTask({
    groupId,
    taskId: job.data.taskId,
    episodeId,
    sourceMode: 'asset_reference',
  })
  if (replayedCompletion) return replayedCompletion
  const shotIds = validateAssetReferenceShotIds(payload.shotIds)
  const referenceImageUrls = parseReferenceImageUrls(payload.referenceImageUrls)
  if (referenceImageUrls.length > 1 && !supportsAssetReferenceMultiReference(modelId)) {
    throw new Error(`ASSET_REFERENCE_VIDEO_MULTI_REFERENCE_UNSUPPORTED:${modelId}`)
  }

  const started = await prisma.projectVideoGroup.updateMany({
    where: { id: groupId, taskId: job.data.taskId, status: { in: ['queued', 'pending', 'generating', 'processing'] } },
    data: {
      status: 'processing',
      taskId: job.data.taskId,
      errorCode: null,
      errorMessage: null,
      referenceImageUrl: referenceImageUrls[0] ?? null,
      referenceImageMediaId: null,
    },
  })
  if (started.count !== 1) throw new Error(`VIDEO_GROUP_TASK_OWNERSHIP_STALE:${groupId}:${job.data.taskId}`)

  await reportTaskProgress(job, 12, { stage: 'asset_reference_video_prepare', groupId })
  const [project, editScript] = await Promise.all([
    prisma.project.findUnique({
      where: { id: job.data.projectId },
      select: {
        videoRatio: true,
      },
    }),
    prisma.projectEditScript.findFirst({
      where: { projectId: job.data.projectId, episodeId, chapterId },
      select: {
        corePlanJson: true,
      },
    }),
  ])
  if (!project) throw new Error('ASSET_REFERENCE_VIDEO_PROJECT_NOT_FOUND')
  if (!editScript) throw new Error('ASSET_REFERENCE_VIDEO_EDIT_SCRIPT_REQUIRED')

  const allShots = parseEditScriptShots(Array.isArray(editScript.corePlanJson) ? editScript.corePlanJson : isJsonRecord(editScript.corePlanJson) ? editScript.corePlanJson.shots : null)
  const shots = resolveVideoGroupShots(allShots, shotIds)
  const durationSec = totalVideoGroupDuration(shots)
  if (durationSec < 1 || durationSec > 15) {
    throw new Error(`ASSET_REFERENCE_VIDEO_DURATION_UNSUPPORTED:${durationSec}`)
  }
  const prompt = await requireProjectVideoGroupPrompt(groupId)
  const generationPrompt = prompt
  const promptPersisted = await prisma.projectVideoGroup.updateMany({
    where: { id: groupId, taskId: job.data.taskId, status: 'processing' },
    data: {
      prompt,
      durationSec,
    },
  })
  if (promptPersisted.count !== 1) throw new Error(`VIDEO_GROUP_TASK_OWNERSHIP_STALE:${groupId}:${job.data.taskId}`)

  await reportTaskProgress(job, 30, { stage: 'asset_reference_video_normalize', groupId })
  const normalizedReferenceImages = await Promise.all(
    referenceImageUrls.map((referenceImageUrl) => normalizeToBase64ForGeneration(referenceImageUrl)),
  )
  const primaryReferenceImage = normalizedReferenceImages[0]
  if (!primaryReferenceImage) throw new Error('ASSET_REFERENCE_VIDEO_PRIMARY_IMAGE_REQUIRED')

  await reportTaskProgress(job, 42, { stage: 'asset_reference_video_generate', groupId })
  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId,
    referenceImages: normalizedReferenceImages.map((url, index) => ({
      url,
      role: 'reference',
      order: index + 1,
      source: 'asset',
    })),
    options: {
      prompt: buildAssetReferencePrompt({
        prompt: generationPrompt,
        referenceImageCount: normalizedReferenceImages.length,
      }),
      ...(project.videoRatio ? { aspectRatio: project.videoRatio } : {}),
      ...generationOptions,
      duration: durationSec,
      generationMode: 'normal',
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
    },
  })

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(modelId)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  await reportTaskProgress(job, 92, { stage: 'asset_reference_video_persist', groupId })
  const cosKey = await uploadVideoSourceToCos(
    videoSource,
    'asset-reference-video',
    groupId,
    downloadHeaders,
    { taskId: job.data.taskId, artifact: `asset-reference-video:${groupId}` },
  )
  const videoMedia = await ensureMediaObjectFromStorageKey(cosKey, {
    mimeType: 'video/mp4',
    durationMs: durationSec * 1000,
  })
  await assertTaskActive(job, 'persist_asset_reference_video')
  const completed = await prisma.projectVideoGroup.updateMany({
    where: { id: groupId, taskId: job.data.taskId, status: 'processing' },
    data: {
      status: 'completed',
      videoUrl: videoMedia.url,
      videoMediaId: videoMedia.id,
      errorCode: null,
      errorMessage: null,
    },
  })
  if (completed.count !== 1) throw new Error(`VIDEO_GROUP_TASK_OWNERSHIP_STALE:${groupId}:${job.data.taskId}`)

  return {
    groupId,
    videoUrl: videoMedia.url,
    videoMediaId: videoMedia.id,
    referenceImageUrl: referenceImageUrls[0] ?? null,
    durationSec,
    shotIds,
    shotNumbers: shots.map((shot) => shot.shotNumber),
    sourceMode: 'asset_reference',
    ...(typeof generatedVideo.actualVideoTokens === 'number'
      ? { actualVideoTokens: generatedVideo.actualVideoTokens }
      : {}),
  }
}

async function handleVideoGroupTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  if (job.data.targetType !== 'ProjectVideoGroup') throw new Error('VIDEO_GROUP_TARGET_REQUIRED')
  const groupId = job.data.targetId
  const modelId = normalizeString(payload.videoModel)
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  const generationOptions = extractGenerationOptions(payload)
  if (normalizeString(payload.sourceMode) === 'asset_reference') {
    return await handleAssetReferenceVideoGroupTask({
      job,
      payload,
      groupId,
      modelId,
      generationOptions,
    })
  }
  const gridMode: VideoGridMode = payload.gridMode === '3x3' ? '3x3' : '2x2'
  const episodeId = job.data.episodeId || normalizeString(payload.episodeId)
  const chapterId = normalizeString(payload.chapterId)
  if (!episodeId) throw new Error('VIDEO_GROUP_EPISODE_REQUIRED')
  if (!chapterId) throw new Error('VIDEO_GROUP_CHAPTER_REQUIRED')
  const replayedCompletion = await readCompletedVideoGroupForTask({
    groupId,
    taskId: job.data.taskId,
    episodeId,
    sourceMode: 'panel_grid',
  })
  if (replayedCompletion) return replayedCompletion
  const shotIds = parseShotIds(payload.shotIds)

  const started = await prisma.projectVideoGroup.updateMany({
    where: { id: groupId, taskId: job.data.taskId, status: { in: ['queued', 'pending', 'generating', 'processing'] } },
    data: {
      status: 'processing',
      taskId: job.data.taskId,
      errorCode: null,
      errorMessage: null,
    },
  })
  if (started.count !== 1) throw new Error(`VIDEO_GROUP_TASK_OWNERSHIP_STALE:${groupId}:${job.data.taskId}`)

  await reportTaskProgress(job, 12, { stage: 'video_group_prepare', groupId })
  const [project, editScript, panels, prompt] = await Promise.all([
    prisma.project.findUnique({
      where: { id: job.data.projectId },
      select: {
        videoRatio: true,
      },
    }),
    prisma.projectEditScript.findFirst({
      where: { projectId: job.data.projectId, episodeId, chapterId },
      select: {
        corePlanJson: true,
      },
    }),
    prisma.projectPanel.findMany({
      where: {
        storyboard: { episodeId, chapterId },
        sourceShotId: { in: shotIds },
      },
      include: {
        imageMedia: true,
      },
    }),
    requireProjectVideoGroupPrompt(groupId),
  ])
  if (!project) throw new Error('VIDEO_GROUP_PROJECT_NOT_FOUND')
  if (!editScript) throw new Error('VIDEO_GROUP_EDIT_SCRIPT_REQUIRED')

  const allShots = parseEditScriptShots(Array.isArray(editScript.corePlanJson) ? editScript.corePlanJson : isJsonRecord(editScript.corePlanJson) ? editScript.corePlanJson.shots : null)
  const normalizedShotIds = validateVideoGroupShotIds({
    gridMode,
    shotIds,
    shots: allShots,
  })
  const shots = resolveVideoGroupShots(allShots, normalizedShotIds)
  const panelByShotId = new Map<string, (typeof panels)[number]>()
  panels.forEach((panel) => {
    if (panel.sourceShotId) panelByShotId.set(panel.sourceShotId, panel)
  })
  const orderedPanels = normalizedShotIds.map((shotId) => {
    const panel = panelByShotId.get(shotId)
    if (!panel) throw new Error(`VIDEO_GROUP_PANEL_NOT_FOUND:${shotId}`)
    if (!panel.imageUrl && !panel.imageMedia?.storageKey) {
      throw new Error(`VIDEO_GROUP_PANEL_IMAGE_MISSING:${shotId}`)
    }
    return panel
  })
  const metadataPersisted = await prisma.projectVideoGroup.updateMany({
    where: { id: groupId, taskId: job.data.taskId, status: 'processing' },
    data: {
      referenceImageUrl: null,
      referenceImageMediaId: null,
      durationSec: totalVideoGroupDuration(shots),
    },
  })
  if (metadataPersisted.count !== 1) throw new Error(`VIDEO_GROUP_TASK_OWNERSHIP_STALE:${groupId}:${job.data.taskId}`)

  await reportTaskProgress(job, 26, { stage: 'video_group_prompt', groupId })
  const generationPrompt = prompt

  await reportTaskProgress(job, 38, { stage: 'video_group_generate', groupId })
  const referenceImages = await Promise.all(orderedPanels.map(async (panel, index) => {
    const sourceImage = panel.imageMedia?.storageKey
      ?? (panel.imageUrl ? toSignedUrlIfCos(panel.imageUrl, 3600) : null)
    if (!sourceImage) throw new Error(`VIDEO_GROUP_PANEL_IMAGE_INVALID:${panel.panelNumber ?? index + 1}`)
    return {
      url: await normalizeToBase64ForGeneration(sourceImage),
      role: 'reference' as const,
      order: index + 1,
      source: 'storyboard' as const,
    }
  }))
  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId,
    referenceImages,
    options: {
      prompt: generationPrompt,
      ...(project.videoRatio ? { aspectRatio: project.videoRatio } : {}),
      ...generationOptions,
      duration: totalVideoGroupDuration(shots),
      generationMode: 'normal',
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
    },
  })

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(modelId)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  await reportTaskProgress(job, 92, { stage: 'video_group_persist', groupId })
  const cosKey = await uploadVideoSourceToCos(
    videoSource,
    'group-video',
    groupId,
    downloadHeaders,
    { taskId: job.data.taskId, artifact: `group-video:${groupId}` },
  )
  const videoMedia = await ensureMediaObjectFromStorageKey(cosKey, {
    mimeType: 'video/mp4',
    durationMs: totalVideoGroupDuration(shots) * 1000,
  })
  await assertTaskActive(job, 'persist_video_group')
  const completed = await prisma.projectVideoGroup.updateMany({
    where: { id: groupId, taskId: job.data.taskId, status: 'processing' },
    data: {
      status: 'completed',
      videoUrl: videoMedia.url,
      videoMediaId: videoMedia.id,
      errorCode: null,
      errorMessage: null,
    },
  })
  if (completed.count !== 1) throw new Error(`VIDEO_GROUP_TASK_OWNERSHIP_STALE:${groupId}:${job.data.taskId}`)

  return {
    groupId,
    videoUrl: videoMedia.url,
    videoMediaId: videoMedia.id,
    durationSec: totalVideoGroupDuration(shots),
    shotIds: normalizedShotIds,
    shotNumbers: shots.map((shot) => shot.shotNumber),
    ...(typeof generatedVideo.actualVideoTokens === 'number'
      ? { actualVideoTokens: generatedVideo.actualVideoTokens }
      : {}),
  }
}

type VideoTaskHandler = (job: Job<TaskJobData>) => Promise<Record<string, unknown> | void>

const VIDEO_TASK_HANDLERS = {
  video_panel: handleVideoPanelTask,
  video_group: handleVideoGroupTask,
  final_video_render: handleFinalVideoRenderTask,
  chapter_render: handleChapterRenderTask,
} satisfies Record<VideoTaskHandlerKey, VideoTaskHandler>

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })
  const definition = getTaskDefinitionForQueue(job.data.type, 'video')
  return await VIDEO_TASK_HANDLERS[definition.workerHandler](job)
}

export function createVideoWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'video',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.video,
        run: async () => await processVideoTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: getWorkerConcurrency('video'),
    },
  )
}
