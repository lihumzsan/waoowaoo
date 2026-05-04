import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import {
  assertTaskActive,
  getProjectModels,
  resolveLipSyncVideoSource,
  resolveVideoSourceFromGeneration,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
} from './utils'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProviderConfig } from '@/lib/api-config'
import {
  parseVideoDurationBinding,
  resolveAudioDrivenVideoTiming,
  type ResolvedAudioDrivenVideoTiming,
  type VideoDurationBinding,
} from '@/lib/video-duration/audio-binding'
import {
  enhanceLtx23VideoPrompt,
  isLtx23VideoModel,
  type Ltx23PromptEnhancementVoiceLine,
} from '@/lib/video-duration/ltx23-prompt-enhance'
import {
  buildDefaultFirstLastFramePrompt,
  buildPanelContinuityPacket,
  isStructuredMultiShotPrompt,
  pickPanelContinuityBasePrompt,
  renderPanelContinuityPrompt,
  type PanelContinuityPacket,
} from '@/lib/novel-promotion/panel-continuity'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'

const DEFAULT_LTX23_SINGLE_SHOT_DURATION_SECONDS = 2
const DEFAULT_LTX23_SINGLE_SHOT_FPS = 24

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function fetchPanelById(panelId: string) {
  return await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    include: {
      storyboard: {
        select: {
          episodeId: true,
          clip: {
            select: {
              content: true,
            },
          },
        },
      },
    },
  })
}

type PanelRecord = NonNullable<Awaited<ReturnType<typeof fetchPanelById>>>

function toDurationMs(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value > 1000 ? Math.round(value) : Math.round(value * 1000)
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

function withStableLtx23SingleShotTiming(
  options: VideoOptionMap,
  params: {
    modelId: string
    generationMode: VideoGenerationMode
  },
): VideoOptionMap {
  if (params.generationMode !== 'normal' || !isLtx23VideoModel(params.modelId)) {
    return options
  }

  const next: VideoOptionMap = { ...options }
  if (typeof next.duration !== 'number' || !Number.isFinite(next.duration) || next.duration <= 0) {
    next.duration = DEFAULT_LTX23_SINGLE_SHOT_DURATION_SECONDS
  }
  if (typeof next.fps !== 'number' || !Number.isFinite(next.fps) || next.fps <= 0) {
    next.fps = DEFAULT_LTX23_SINGLE_SHOT_FPS
  }
  return next
}

async function fetchPanelByStoryboardIndex(storyboardId: string, panelIndex: number) {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
    },
    include: {
      storyboard: {
        select: {
          episodeId: true,
          clip: {
            select: {
              content: true,
            },
          },
        },
      },
    },
  })
}

async function fetchContinuityNeighborPanel(storyboardId: string, panelIndex: number) {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
    },
    select: {
      id: true,
      panelIndex: true,
      description: true,
      imagePrompt: true,
      videoPrompt: true,
      videoPromptEditedByUser: true,
      firstLastFramePrompt: true,
      firstLastFramePromptEditedByUser: true,
      location: true,
      characters: true,
      props: true,
      srtSegment: true,
      shotType: true,
      cameraMove: true,
      sceneType: true,
      imageUrl: true,
    },
  })
}

async function getPanelForVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj

  // 优先使用 targetType=NovelPromotionPanel 直接定位
  if (job.data.targetType === 'NovelPromotionPanel') {
    const panel = await fetchPanelById(job.data.targetId)
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

function readVideoDurationBindingFromPayload(payload: AnyObj): VideoDurationBinding | null {
  const raw = payload.videoDurationBinding
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return parseVideoDurationBinding(raw)
}

async function resolveEffectiveVideoDurationBinding(
  panel: PanelRecord,
  payload: AnyObj,
): Promise<VideoDurationBinding> {
  const payloadBinding = readVideoDurationBindingFromPayload(payload)
  if (payloadBinding?.mode === 'match_audio' && (payloadBinding.voiceLineIds || []).length > 0) {
    return payloadBinding
  }

  const savedBinding = parseVideoDurationBinding(panel.videoDurationBinding)
  if (savedBinding.mode === 'match_audio' && (savedBinding.voiceLineIds || []).length > 0) {
    return savedBinding
  }

  const autoMatchedVoiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId: panel.storyboard.episodeId,
      OR: [
        { matchedPanelId: panel.id },
        {
          matchedPanelId: null,
          matchedStoryboardId: panel.storyboardId,
          matchedPanelIndex: panel.panelIndex,
        },
      ],
      audioDuration: { not: null },
    },
    orderBy: { lineIndex: 'asc' },
    select: { id: true },
  })
  const voiceLineIds = autoMatchedVoiceLines.map((line) => line.id)
  return voiceLineIds.length > 0
    ? { mode: 'match_audio', voiceLineIds }
    : savedBinding
}

async function loadAudioDrivenVoiceLines(
  panel: PanelRecord,
  binding: VideoDurationBinding,
): Promise<Ltx23PromptEnhancementVoiceLine[]> {
  if (binding.mode !== 'match_audio') return []

  const selectedVoiceLineIds = Array.isArray(binding.voiceLineIds) ? binding.voiceLineIds : []
  if (selectedVoiceLineIds.length === 0) return []

  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      id: { in: selectedVoiceLineIds },
      episodeId: panel.storyboard.episodeId,
    },
    select: {
      id: true,
      speaker: true,
      content: true,
      audioDuration: true,
    },
  })

  const order = new Map(selectedVoiceLineIds.map((id, index) => [id, index]))
  return voiceLines.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
}

async function resolveAudioDrivenDurationOverride(
  panel: PanelRecord,
  binding: VideoDurationBinding,
  modelId: string,
  voiceLines?: Ltx23PromptEnhancementVoiceLine[],
): Promise<ResolvedAudioDrivenVideoTiming | null> {
  if (binding.mode !== 'match_audio') return null

  const selectedVoiceLineIds = Array.isArray(binding.voiceLineIds) ? binding.voiceLineIds : []
  if (selectedVoiceLineIds.length === 0) return null

  const candidates = Array.isArray(voiceLines) && voiceLines.length > 0
    ? voiceLines
    : await loadAudioDrivenVoiceLines(panel, binding)
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', modelId)

  const timing = resolveAudioDrivenVideoTiming({
    binding,
    candidates,
    modelKey: modelId,
    durationOptions: capabilities?.video?.durationOptions,
    context: {
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      sceneType: panel.sceneType,
      clipContent: panel.storyboard.clip?.content ?? null,
      srtSegment: panel.srtSegment,
    },
  })

  if (!timing) return null
  if (!timing.canGenerate) {
    const maxText = timing.maxDurationSeconds === null ? 'unknown' : `${timing.maxDurationSeconds.toFixed(1)}s`
    if (timing.blockedReason === 'audio_exceeds_max_duration') {
      throw new Error(`VIDEO_AUDIO_DURATION_EXCEEDS_WORKFLOW_MAX: audio ${timing.audioDurationSeconds.toFixed(1)}s exceeds workflow max ${maxText}`)
    }
    throw new Error(`VIDEO_TARGET_DURATION_EXCEEDS_WORKFLOW_MAX: target ${timing.targetDurationSeconds.toFixed(1)}s exceeds workflow max ${maxText}`)
  }
  return timing
}

async function assembleVideoContinuityPacket(params: {
  panel: PanelRecord
  nextPanel?: Awaited<ReturnType<typeof fetchContinuityNeighborPanel>> | null
  linkedVoiceLines: Ltx23PromptEnhancementVoiceLine[]
  durationSeconds?: number | null
}): Promise<PanelContinuityPacket> {
  const previousPanel = await fetchContinuityNeighborPanel(params.panel.storyboardId, params.panel.panelIndex - 1)
  const nextPanel = params.nextPanel !== undefined
    ? params.nextPanel
    : await fetchContinuityNeighborPanel(params.panel.storyboardId, params.panel.panelIndex + 1)

  return buildPanelContinuityPacket({
    panel: params.panel,
    previousPanel,
    nextPanel,
    dialogueLines: params.linkedVoiceLines,
    targetDurationSeconds: params.durationSeconds,
  })
}

async function generateVideoForPanel(
  job: Job<TaskJobData>,
  panel: PanelRecord,
  payload: AnyObj,
  modelId: string,
  projectVideoRatio: string | null | undefined,
  projectArtStyle: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<{
  cosKey: string
  generationMode: VideoGenerationMode
  actualVideoTokens?: number
  firstLastFramePromptToPersist?: string
}> {
  if (!panel.imageUrl) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }

  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = readNonEmptyString(firstLastFramePayload?.customPrompt)
  const persistedFirstLastPrompt = firstLastFramePayload
    && !isStructuredMultiShotPrompt(panel.firstLastFramePrompt)
    ? readNonEmptyString(panel.firstLastFramePrompt)
    : null
  const customPrompt = readNonEmptyString(payload.customPrompt)

  const sourceImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!sourceImageUrl) {
    throw new Error(`Panel ${panel.id} image url invalid`)
  }
  const sourceImageBase64 = await normalizeToBase64ForGeneration(sourceImageUrl)

  let lastFrameImageBase64: string | undefined
  let lastPanel: Awaited<ReturnType<typeof fetchContinuityNeighborPanel>> | null = null
  const generationMode: VideoGenerationMode = firstLastFramePayload ? 'firstlastframe' : 'normal'
  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  let model = modelId

  if (firstLastFramePayload) {
    model =
      typeof firstLastFramePayload.flModel === 'string' && firstLastFramePayload.flModel
        ? firstLastFramePayload.flModel
        : modelId
    const firstLastFrameCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
    if (firstLastFrameCapabilities?.video?.firstlastframe !== true) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED: ${model}`)
    }
    if (
      typeof firstLastFramePayload.lastFrameStoryboardId === 'string' &&
      firstLastFramePayload.lastFrameStoryboardId &&
      firstLastFramePayload.lastFramePanelIndex !== undefined
    ) {
      const lastPanel = await fetchPanelByStoryboardIndex(
        firstLastFramePayload.lastFrameStoryboardId,
        Number(firstLastFramePayload.lastFramePanelIndex),
      )
      if (lastPanel) {
        const lastFrameUrl = toSignedUrlIfCos(lastPanel.imageUrl, 3600)
        if (lastFrameUrl) {
          lastFrameImageBase64 = await normalizeToBase64ForGeneration(lastFrameUrl)
        }
      }
    }
    if (!lastFrameImageBase64) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_LAST_FRAME_REQUIRED: panel ${panel.id} needs a valid last-frame panel image`)
    }
  }

  if (firstLastFramePayload) {
    const lastStoryboardId = readNonEmptyString(firstLastFramePayload.lastFrameStoryboardId)
    const lastPanelIndex = firstLastFramePayload.lastFramePanelIndex
    if (lastStoryboardId && lastPanelIndex !== undefined && lastPanelIndex !== null) {
      lastPanel = await fetchContinuityNeighborPanel(lastStoryboardId, Number(lastPanelIndex))
    }
  }

  const defaultFirstLastPrompt = firstLastFramePayload && lastPanel
    ? buildDefaultFirstLastFramePrompt({ firstPanel: panel, lastPanel })
    : null
  const savedPanelPrompt = pickPanelContinuityBasePrompt(panel)
  const basePrompt = firstLastCustomPrompt
    || persistedFirstLastPrompt
    || customPrompt
    || defaultFirstLastPrompt
    || savedPanelPrompt
  const promptEditedByUser = Boolean(
    firstLastCustomPrompt
    || customPrompt
    || (firstLastFramePayload
      ? (persistedFirstLastPrompt && panel.firstLastFramePromptEditedByUser)
      : (savedPanelPrompt === readNonEmptyString(panel.videoPrompt) && panel.videoPromptEditedByUser))
  )
  if (!basePrompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }

  const durationBinding = await resolveEffectiveVideoDurationBinding(panel, payload)
  const linkedVoiceLines = await loadAudioDrivenVoiceLines(panel, durationBinding)
  const audioDrivenDuration = await resolveAudioDrivenDurationOverride(panel, durationBinding, model, linkedVoiceLines)
  const effectiveGenerationOptions = withStableLtx23SingleShotTiming({
    ...generationOptions,
    ...(audioDrivenDuration ? {
      duration: audioDrivenDuration.targetDurationSeconds,
      fps: audioDrivenDuration.fps,
    } : {}),
  }, {
    modelId: model,
    generationMode,
  })
  const continuityPacket = await assembleVideoContinuityPacket({
    panel,
    nextPanel: lastPanel,
    linkedVoiceLines,
    durationSeconds: typeof effectiveGenerationOptions.duration === 'number'
      ? effectiveGenerationOptions.duration
      : null,
  })
  const continuityPrompt = renderPanelContinuityPrompt({
    packet: continuityPacket,
    basePrompt,
    generationMode,
    userEdited: promptEditedByUser,
  })
  const effectivePrompt = (
    await enhanceLtx23VideoPrompt({
      userId: job.data.userId,
      locale: job.data.locale,
      projectId: job.data.projectId,
      modelKey: model,
      originalPrompt: continuityPrompt,
      panel: {
        panelIndex: panel.panelIndex,
        shotType: panel.shotType,
        cameraMove: panel.cameraMove,
        description: panel.description,
        location: panel.location,
        characters: panel.characters,
        props: panel.props,
        srtSegment: panel.srtSegment,
        sceneType: panel.sceneType,
        clipContent: panel.storyboard.clip?.content ?? null,
      },
      linkedVoiceLines,
      durationSeconds: typeof effectiveGenerationOptions.duration === 'number' ? effectiveGenerationOptions.duration : null,
      fps: typeof effectiveGenerationOptions.fps === 'number' ? effectiveGenerationOptions.fps : null,
      audioTiming: audioDrivenDuration,
      generationMode,
      artStyle: projectArtStyle,
      userEdited: promptEditedByUser,
      continuity: continuityPacket,
    })
  ).prompt

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    imageUrl: sourceImageBase64,
    options: {
      prompt: effectivePrompt,
      ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
      ...effectiveGenerationOptions,
      generationMode,
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
      ...(lastFrameImageBase64 ? { lastFrameImageUrl: lastFrameImageBase64 } : {}),
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

  const cosKey = await uploadVideoSourceToCos(videoSource, 'panel-video', panel.id, downloadHeaders)
  return {
    cosKey,
    generationMode,
    ...(firstLastFramePayload && (firstLastCustomPrompt || persistedFirstLastPrompt || defaultFirstLastPrompt)
      ? { firstLastFramePromptToPersist: firstLastCustomPrompt || persistedFirstLastPrompt || defaultFirstLastPrompt || undefined }
      : {}),
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

  const { cosKey, generationMode, actualVideoTokens, firstLastFramePromptToPersist } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio,
    projectModels.artStyle,
    generationOptions,
  )

  await assertTaskActive(job, 'persist_panel_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      videoUrl: cosKey,
      videoGenerationMode: generationMode,
      ...(firstLastFramePromptToPersist ? { firstLastFramePrompt: firstLastFramePromptToPersist } : {}),
    },
  })

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    ...(typeof actualVideoTokens === 'number' ? { actualVideoTokens } : {}),
  }
}

async function handleLipSyncTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lipSyncModel = typeof payload.lipSyncModel === 'string' && payload.lipSyncModel.trim()
    ? payload.lipSyncModel.trim()
    : undefined

  let panel: PanelRecord | null = null
  if (job.data.targetType === 'NovelPromotionPanel') {
    panel = await fetchPanelById(job.data.targetId)
  }

  if (
    !panel &&
    typeof payload.storyboardId === 'string' &&
    payload.storyboardId &&
    payload.panelIndex !== undefined
  ) {
    panel = await fetchPanelByStoryboardIndex(payload.storyboardId, Number(payload.panelIndex))
  }

  if (!panel) throw new Error('Lip-sync panel not found')
  if (!panel.videoUrl) throw new Error('Panel has no base video')

  const voiceLineId = typeof payload.voiceLineId === 'string' ? payload.voiceLineId : null
  if (!voiceLineId) throw new Error('Lip-sync task missing voiceLineId')

  const voiceLine = await prisma.novelPromotionVoiceLine.findUnique({ where: { id: voiceLineId } })
  if (!voiceLine || !voiceLine.audioUrl) {
    throw new Error('Voice line or audioUrl not found')
  }

  const signedVideoUrl = toSignedUrlIfCos(panel.videoUrl, 7200)
  const signedAudioUrl = toSignedUrlIfCos(voiceLine.audioUrl, 7200)

  if (!signedVideoUrl || !signedAudioUrl) {
    throw new Error('Lip-sync input media url invalid')
  }

  await reportTaskProgress(job, 25, { stage: 'submit_lip_sync' })

  const source = await resolveLipSyncVideoSource(job, {
    userId: job.data.userId,
    videoUrl: signedVideoUrl,
    audioUrl: signedAudioUrl,
    audioDurationMs: typeof voiceLine.audioDuration === 'number' ? voiceLine.audioDuration : undefined,
    videoDurationMs: toDurationMs(panel.duration),
    modelKey: lipSyncModel,
  })

  await reportTaskProgress(job, 93, { stage: 'persist_lip_sync' })

  const cosKey = await uploadVideoSourceToCos(source, 'lip-sync', panel.id)

  await assertTaskActive(job, 'persist_lip_sync_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      lipSyncVideoUrl: cosKey,
      lipSyncTaskId: null,
    },
  })

  return {
    panelId: panel.id,
    voiceLineId,
    lipSyncVideoUrl: cosKey,
  }
}

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VIDEO_PANEL:
      return await handleVideoPanelTask(job)
    case TASK_TYPE.LIP_SYNC:
      return await handleLipSyncTask(job)
    default:
      throw new Error(`Unsupported video task type: ${job.data.type}`)
  }
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
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VIDEO || '4', 10) || 4,
    },
  )
}
