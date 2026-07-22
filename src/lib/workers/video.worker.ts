import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { handleVideoSeamConcatTask } from './handlers/video-seam-concat'
import {
  handleEnvironmentSoundAnalyzeTask,
  handleEnvironmentSoundCleanupTask,
  handleEnvironmentSoundGenerateTask,
} from './handlers/environment-sound'
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
import {
  DEFAULT_VIDEO_MODEL_KEY,
  isBerniniAudioLipsyncVideoModelKey,
  normalizeVideoModelKey,
} from '@/lib/novel-promotion/video-model-defaults'
import {
  COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
  COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID,
  getLtx23WorkflowProfile,
  normalizeLtx23GoonDurationSeconds,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import { resolveLtx23WorkflowRoute } from '@/lib/providers/comfyui/ltx23-workflow-router'
import {
  SEEDANCE2_BERNINI_DEFAULT_DURATION_SECONDS,
  SEEDANCE2_BERNINI_DEFAULT_FPS,
  isSeedance2BerniniWorkflowKey,
} from '@/lib/providers/comfyui/seedance2-bernini-workflow'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'
type WorkflowVideoGenerationMode = 'normal' | 'firstlastframe'

const DEFAULT_LEGACY_LTX23_SINGLE_SHOT_DURATION_SECONDS = 2
const DEFAULT_LEGACY_LTX23_SINGLE_SHOT_FPS = 24

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeWorkerVideoModelKey(raw: string | null | undefined): string {
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\\/g, '/') : ''
  if (!trimmed) return ''
  const normalized = normalizeVideoModelKey(trimmed)
  if (
    normalized === COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY
    || normalized === COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID
  ) {
    return normalized
  }
  return isBerniniAudioLipsyncVideoModelKey(trimmed)
    ? DEFAULT_VIDEO_MODEL_KEY
    : trimmed
}

function readPositiveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readBooleanFlag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readSerializedLtx23RoutingDurationSeconds(payload: AnyObj, modelId: string): number | null {
  const routing = payload.ltx23WorkflowRouting
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return null

  const routeRecord = routing as AnyObj
  const selectedModelKey = readNonEmptyString(routeRecord.selectedModelKey)
  if (selectedModelKey && selectedModelKey !== modelId) return null

  return readPositiveFiniteNumber(routeRecord.durationSeconds)
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

function withLtx23ProfileTiming(
  options: VideoOptionMap,
  params: {
    modelId: string
    generationMode: WorkflowVideoGenerationMode
  },
): VideoOptionMap {
  const profile = getLtx23WorkflowProfile(params.modelId)
  if (!profile && (params.generationMode !== 'normal' || !isLtx23VideoModel(params.modelId))) {
    return options
  }

  const next: VideoOptionMap = { ...options }
  if (typeof next.duration !== 'number' || !Number.isFinite(next.duration) || next.duration <= 0) {
    next.duration = profile?.defaultDurationSeconds ?? DEFAULT_LEGACY_LTX23_SINGLE_SHOT_DURATION_SECONDS
  }
  if (typeof next.fps !== 'number' || !Number.isFinite(next.fps) || next.fps <= 0) {
    next.fps = profile?.fps ?? DEFAULT_LEGACY_LTX23_SINGLE_SHOT_FPS
  }
  return next
}

function withVideoWorkflowTimingDefaults(
  options: VideoOptionMap,
  params: {
    modelId: string
    generationMode: WorkflowVideoGenerationMode
  },
): VideoOptionMap {
  if (!isSeedance2BerniniWorkflowKey(params.modelId)) {
    return withLtx23ProfileTiming(options, params)
  }

  const next: VideoOptionMap = { ...options }
  if (typeof next.duration !== 'number' || !Number.isFinite(next.duration) || next.duration <= 0) {
    next.duration = SEEDANCE2_BERNINI_DEFAULT_DURATION_SECONDS
  }
  next.fps = SEEDANCE2_BERNINI_DEFAULT_FPS
  return next
}

function allowsCustomVideoWorkflowDuration(modelId: string, hasExactTimingOverride: boolean): boolean {
  if (isSeedance2BerniniWorkflowKey(modelId)) return true
  return hasExactTimingOverride && isLtx23VideoModel(modelId)
}

function throwBlockedAudioTiming(timing: ResolvedAudioDrivenVideoTiming): never {
  const maxText = timing.maxDurationSeconds === null ? 'unknown' : `${timing.maxDurationSeconds.toFixed(1)}s`
  if (timing.blockedReason === 'audio_exceeds_max_duration') {
    throw new Error(`VIDEO_AUDIO_DURATION_EXCEEDS_WORKFLOW_MAX: audio ${timing.audioDurationSeconds.toFixed(1)}s exceeds workflow max ${maxText}`)
  }
  throw new Error(`VIDEO_TARGET_DURATION_EXCEEDS_WORKFLOW_MAX: target ${timing.targetDurationSeconds.toFixed(1)}s exceeds workflow max ${maxText}`)
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

function resolveFirstLastFrameTargetDurationBinding(
  panel: PanelRecord,
  payload: AnyObj,
): VideoDurationBinding | null {
  const payloadBinding = readVideoDurationBindingFromPayload(payload)
  const payloadTargetDurationSeconds = readPositiveFiniteNumber(payloadBinding?.targetDurationSeconds)
  if (payloadBinding && payloadTargetDurationSeconds !== null) {
    return {
      ...payloadBinding,
      targetDurationSeconds: normalizeLtx23GoonDurationSeconds(payloadTargetDurationSeconds),
    }
  }

  const savedBinding = parseVideoDurationBinding(panel.videoDurationBinding)
  const savedTargetDurationSeconds = readPositiveFiniteNumber(savedBinding.targetDurationSeconds)
  if (savedTargetDurationSeconds !== null) {
    return {
      ...savedBinding,
      targetDurationSeconds: normalizeLtx23GoonDurationSeconds(savedTargetDurationSeconds),
    }
  }

  return null
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
      audioUrl: true,
    },
  })

  const order = new Map(selectedVoiceLineIds.map((id, index) => [id, index]))
  return voiceLines.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
}

function resolveReferenceAudioUrls(voiceLines: Ltx23PromptEnhancementVoiceLine[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const line of voiceLines) {
    const audioUrl = readNonEmptyString(line.audioUrl)
    if (!audioUrl) continue

    const signedUrl = toSignedUrlIfCos(audioUrl, 7200)
    if (!signedUrl || seen.has(signedUrl)) continue

    seen.add(signedUrl)
    urls.push(signedUrl)
  }
  return urls
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
    fpsOptions: capabilities?.video?.fpsOptions,
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
  return timing
}

function sumVoiceLineDurationSeconds(voiceLines: Ltx23PromptEnhancementVoiceLine[]): number | null {
  const totalMs = voiceLines.reduce((sum, line) => {
    const duration = line.audioDuration
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? sum + duration
      : sum
  }, 0)
  return totalMs > 0 ? Number((totalMs / 1000).toFixed(2)) : null
}

function promoteRequestedDurationToAudioTarget(
  binding: VideoDurationBinding,
  requestedDurationSeconds: number | null,
  audioDurationSeconds: number | null,
  modelKey: string,
): VideoDurationBinding {
  if (!isLtx23VideoModel(modelKey) || binding.mode !== 'match_audio' || requestedDurationSeconds === null) return binding

  const currentTarget = readPositiveFiniteNumber(binding.targetDurationSeconds)
  if (currentTarget !== null && (audioDurationSeconds === null || currentTarget + 0.001 >= audioDurationSeconds)) {
    return binding
  }

  if (audioDurationSeconds !== null && requestedDurationSeconds + 0.001 < audioDurationSeconds) {
    return binding
  }

  return {
    ...binding,
    targetDurationSeconds: Number(requestedDurationSeconds.toFixed(2)),
  }
}

async function assembleVideoContinuityPacket(params: {
  panel: PanelRecord
  nextPanel?: Awaited<ReturnType<typeof fetchContinuityNeighborPanel>> | null
  linkedVoiceLines: Ltx23PromptEnhancementVoiceLine[]
  durationSeconds?: number | null
  includeDialogueText?: boolean
}): Promise<PanelContinuityPacket> {
  const previousPanel = await fetchContinuityNeighborPanel(params.panel.storyboardId, params.panel.panelIndex - 1)
  const nextPanel = params.nextPanel !== undefined
    ? params.nextPanel
    : await fetchContinuityNeighborPanel(params.panel.storyboardId, params.panel.panelIndex + 1)
  const includeDialogueText = params.includeDialogueText !== false

  return buildPanelContinuityPacket({
    panel: includeDialogueText ? params.panel : omitPanelDialogueText(params.panel),
    previousPanel: includeDialogueText ? previousPanel : omitPanelDialogueText(previousPanel),
    nextPanel: includeDialogueText ? nextPanel : omitPanelDialogueText(nextPanel),
    dialogueLines: includeDialogueText ? params.linkedVoiceLines : [],
    targetDurationSeconds: params.durationSeconds,
  })
}

function omitPanelDialogueText<T extends { srtSegment?: string | null } | null | undefined>(panel: T): T {
  if (!panel) return panel
  return {
    ...panel,
    srtSegment: null,
  }
}

const BERNINI_AUDIO_VISUAL_SPEAKING_PHRASE =
  'the subject faces the camera and performs natural rhythmic mouth movement with subtle head motion, restrained eye movement, and small body-language gestures while the spoken words stay in the audio track'

const BERNINI_AUDIO_SPEAKING_INTENT_PATTERN =
  /\b(?:says?|speaks?|talks?|asks?|answers?|utters?|dialogue|voice|mouth)\b|[\u8bf4\u8bb2\u95ee\u7b54]|\u53e3\u64ad|\u5bf9\u767d|\u53f0\u8bcd|\u4ea4\u8c08/i

const BERNINI_AUDIO_QUOTED_DIALOGUE_PATTERNS = [
  /"[^"\n]{1,320}"/g,
  /\u201c[^\u201d\n]{1,320}\u201d/g,
  /\u300c[^\u300d\n]{1,320}\u300d/g,
  /\u300e[^\u300f\n]{1,320}\u300f/g,
]

const BERNINI_AUDIO_SPEECH_CUE_PAYLOAD_PATTERNS = [
  /\b(says?|speaks?|talks?|asks?|answers?|utters?)\s*[:\uff1a]\s*[^.\n]+/gi,
  /((?:\u5bf9[^\n:\uff1a]{0,32})?[\u8bf4\u95ee\u7b54]\u9053?)\s*[:\uff1a]\s*[^.\u3002\n]+/g,
]

const BERNINI_AUDIO_POSITIVE_TEXT_GUARD_LINE_PATTERN =
  /^\s*(?:do not add|do not render|never convert|hard visual constraint:|dialogue must stay)\b.*\b(?:subtitles?|captions?|text overlays?|readable text|chinese characters|on-screen text|prompt text|ui text)\b/i

const BERNINI_AUDIO_POSITIVE_TEXT_TERM_PATTERNS = [
  /\b(?:no|without|avoid|never render|do not render|do not add)\s+(?:subtitles?|captions?|closed captions?|text overlays?|watermarks?|logos?|signs?|labels?|ui text|readable text|chinese characters|english letters|lower thirds?)\b/gi,
  /\b(?:subtitles?|captions?|closed captions?|text overlays?|watermarks?|logos?|ui text|readable text|chinese characters|english letters|lower thirds?|karaoke text|lyrics text|dialogue text|speech bubbles|on-screen text)\b/gi,
]

function stripBerniniAudioQuotedDialogue(value: string): string {
  let next = value
  for (const pattern of BERNINI_AUDIO_QUOTED_DIALOGUE_PATTERNS) {
    next = next.replace(pattern, '')
  }
  for (const pattern of BERNINI_AUDIO_SPEECH_CUE_PAYLOAD_PATTERNS) {
    next = next.replace(pattern, '$1')
  }
  return next
}

function removeBerniniAudioPositiveTextTerms(value: string): string {
  let next = value
    .split('\n')
    .filter((line) => !BERNINI_AUDIO_POSITIVE_TEXT_GUARD_LINE_PATTERN.test(line))
    .join('\n')
    .replace(/^Source text:/gim, 'Source cue:')

  for (const pattern of BERNINI_AUDIO_POSITIVE_TEXT_TERM_PATTERNS) {
    next = next.replace(pattern, '')
  }

  return next
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*,[ \t]*(?=[,.;:\n])/g, '')
    .replace(/(?:,[ \t]*){2,}/g, ', ')
    .replace(/[ \t]+([,.;:])/g, '$1')
    .replace(/^[\s,.;:-]+$/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function buildBerniniAudioLtxStylePrompt(params: {
  basePrompt: string
  continuityPrompt: string
}): string {
  const sourcePrompt = params.continuityPrompt.trim() || params.basePrompt.trim()
  const hasSpeakingIntent =
    BERNINI_AUDIO_SPEAKING_INTENT_PATTERN.test(sourcePrompt)
    || BERNINI_AUDIO_SPEAKING_INTENT_PATTERN.test(params.basePrompt)

  let prompt = stripBerniniAudioQuotedDialogue(sourcePrompt)
  prompt = removeBerniniAudioPositiveTextTerms(prompt)

  if (hasSpeakingIntent && !/natural rhythmic mouth movement/i.test(prompt)) {
    prompt = [prompt, `Audio performance: ${BERNINI_AUDIO_VISUAL_SPEAKING_PHRASE}.`]
      .filter(Boolean)
      .join('\n')
  }

  return prompt || (hasSpeakingIntent ? BERNINI_AUDIO_VISUAL_SPEAKING_PHRASE : sourcePrompt)
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
  firstLastFramePromptEditedByUserToPersist?: boolean
}> {
  if (!panel.imageUrl) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }

  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = readNonEmptyString(firstLastFramePayload?.customPrompt)
  const firstLastCustomPromptEditedByUser = firstLastFramePayload
    ? readBooleanFlag(firstLastFramePayload.customPromptEditedByUser)
    : null
  const persistedFirstLastPrompt = firstLastFramePayload
    && !isStructuredMultiShotPrompt(panel.firstLastFramePrompt)
    ? readNonEmptyString(panel.firstLastFramePrompt)
    : null
  const customPrompt = readNonEmptyString(payload.customPrompt)
  const customPromptEditedByUser = readBooleanFlag(payload.customPromptEditedByUser)

  const sourceImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!sourceImageUrl) {
    throw new Error(`Panel ${panel.id} image url invalid`)
  }
  const sourceImageBase64 = await normalizeToBase64ForGeneration(sourceImageUrl)

  let lastFrameImageBase64: string | undefined
  let lastPanel: Awaited<ReturnType<typeof fetchContinuityNeighborPanel>> | null = null
  const generationMode: WorkflowVideoGenerationMode = firstLastFramePayload ? 'firstlastframe' : 'normal'
  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  let model = modelId

  if (firstLastFramePayload) {
    model =
      typeof firstLastFramePayload.flModel === 'string' && firstLastFramePayload.flModel
        ? normalizeWorkerVideoModelKey(firstLastFramePayload.flModel)
        : modelId
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
  const promptEditedByUser = Boolean(firstLastFramePayload
    ? (
        firstLastCustomPromptEditedByUser
        ?? Boolean(persistedFirstLastPrompt && panel.firstLastFramePromptEditedByUser)
      )
    : (
        customPromptEditedByUser
        ?? (savedPanelPrompt === readNonEmptyString(panel.videoPrompt) && panel.videoPromptEditedByUser)
      ))
  if (!basePrompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }

  const firstLastTargetDurationBinding = firstLastFramePayload
    ? resolveFirstLastFrameTargetDurationBinding(panel, payload)
    : null
  let durationBinding = firstLastTargetDurationBinding
    || await resolveEffectiveVideoDurationBinding(panel, payload)
  const linkedVoiceLines = await loadAudioDrivenVoiceLines(panel, durationBinding)
  const linkedAudioDurationSeconds = sumVoiceLineDurationSeconds(linkedVoiceLines)
  const requestedGenerationDurationSeconds = typeof generationOptions.duration === 'number'
    ? readPositiveFiniteNumber(generationOptions.duration)
    : null
  durationBinding = promoteRequestedDurationToAudioTarget(
    durationBinding,
    requestedGenerationDurationSeconds,
    linkedAudioDurationSeconds,
    model,
  )
  const referenceAudioUrls = resolveReferenceAudioUrls(linkedVoiceLines)
  let routedGenerationOptions = generationOptions
  const serializedRouteDurationSeconds = readSerializedLtx23RoutingDurationSeconds(payload, model)
  const firstLastFrameTargetDurationSeconds = firstLastFramePayload
    ? readPositiveFiniteNumber(durationBinding.targetDurationSeconds)
    : null
  const workflowRoute = resolveLtx23WorkflowRoute({
    modelKey: model,
    selectionMode: payload.ltx23WorkflowSelection,
    generationMode,
    requestedDurationSeconds: firstLastFrameTargetDurationSeconds
      ?? serializedRouteDurationSeconds
      ?? (typeof generationOptions.duration === 'number' ? generationOptions.duration : null),
    targetDurationSeconds: firstLastFrameTargetDurationSeconds
      ?? readPositiveFiniteNumber(durationBinding.targetDurationSeconds),
    audioDurationSeconds: linkedAudioDurationSeconds,
    panel: {
      videoPrompt: basePrompt,
      description: panel.description,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      sceneType: panel.sceneType,
      srtSegment: panel.srtSegment,
      clipContent: panel.storyboard.clip?.content ?? null,
    },
  })
  if (workflowRoute) {
    model = workflowRoute.selectedModelKey
    routedGenerationOptions = {
      ...routedGenerationOptions,
      duration: workflowRoute.durationSeconds,
    }
  }

  if (firstLastFramePayload) {
    const firstLastFrameCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
    if (firstLastFrameCapabilities?.video?.firstlastframe !== true) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED: ${model}`)
    }
  }

  const audioDrivenDuration = await resolveAudioDrivenDurationOverride(panel, durationBinding, model, linkedVoiceLines)
  if (audioDrivenDuration && !audioDrivenDuration.canGenerate) {
    throwBlockedAudioTiming(audioDrivenDuration)
  }
  const isBerniniAudioDriven = isSeedance2BerniniWorkflowKey(model) && referenceAudioUrls.length > 0
  const shouldKeepDialogueAudioOnly = referenceAudioUrls.length > 0
    && (isBerniniAudioDriven || isLtx23VideoModel(model))
  const effectiveGenerationOptions = withVideoWorkflowTimingDefaults({
    ...routedGenerationOptions,
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
    includeDialogueText: !shouldKeepDialogueAudioOnly,
  })
  const continuityPrompt = renderPanelContinuityPrompt({
    packet: continuityPacket,
    basePrompt,
    generationMode,
    userEdited: promptEditedByUser,
  })
  const isGoonFirstLastFrame = Boolean(
    firstLastFramePayload && model === COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY,
  )
  const effectivePrompt = isGoonFirstLastFrame
    ? basePrompt
    : isLtx23VideoModel(model)
    ? (
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
            srtSegment: shouldKeepDialogueAudioOnly ? null : panel.srtSegment,
            sceneType: panel.sceneType,
            clipContent: panel.storyboard.clip?.content ?? null,
          },
          linkedVoiceLines,
          durationSeconds: typeof effectiveGenerationOptions.duration === 'number' ? effectiveGenerationOptions.duration : null,
          fps: typeof effectiveGenerationOptions.fps === 'number' ? effectiveGenerationOptions.fps : null,
          motionStrength: typeof effectiveGenerationOptions.motionStrength === 'number'
            ? effectiveGenerationOptions.motionStrength
            : null,
          audioTiming: audioDrivenDuration,
          generationMode,
          artStyle: projectArtStyle,
          userEdited: promptEditedByUser,
          continuity: continuityPacket,
        })
      ).prompt
    : isBerniniAudioDriven
      ? buildBerniniAudioLtxStylePrompt({ basePrompt, continuityPrompt })
      : continuityPrompt

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    imageUrl: sourceImageBase64,
    allowCustomDuration: allowsCustomVideoWorkflowDuration(model, Boolean(audioDrivenDuration || workflowRoute)),
    options: {
      prompt: effectivePrompt,
      ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
      ...effectiveGenerationOptions,
      generationMode,
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
      ...(lastFrameImageBase64 ? { lastFrameImageUrl: lastFrameImageBase64 } : {}),
      ...(referenceAudioUrls.length > 0 ? { referenceAudioUrls } : {}),
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

  const cosKey = generatedVideo.stream
    ? await uploadVideoSourceToCos(
        videoSource,
        'panel-video',
        panel.id,
        downloadHeaders,
        generatedVideo.stream,
      )
    : await uploadVideoSourceToCos(videoSource, 'panel-video', panel.id, downloadHeaders)
  return {
    cosKey,
    generationMode,
    ...(firstLastFramePayload && (firstLastCustomPrompt || persistedFirstLastPrompt || defaultFirstLastPrompt)
      ? {
          firstLastFramePromptToPersist: firstLastCustomPrompt || persistedFirstLastPrompt || defaultFirstLastPrompt || undefined,
          firstLastFramePromptEditedByUserToPersist: promptEditedByUser,
        }
      : {}),
    ...(typeof generatedVideo.actualVideoTokens === 'number'
      ? { actualVideoTokens: generatedVideo.actualVideoTokens }
      : {}),
  }
}

async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const rawModelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  const modelId = normalizeWorkerVideoModelKey(rawModelId)
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const panel = await getPanelForVideoTask(job)

  const generationOptions = extractGenerationOptions(payload)

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const {
    cosKey,
    generationMode,
    actualVideoTokens,
    firstLastFramePromptToPersist,
    firstLastFramePromptEditedByUserToPersist,
  } = await generateVideoForPanel(
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
      videoModel: modelId,
      videoGenerationMode: generationMode,
      ...(firstLastFramePromptToPersist ? {
        firstLastFramePrompt: firstLastFramePromptToPersist,
        firstLastFramePromptEditedByUser: firstLastFramePromptEditedByUserToPersist === true,
      } : {}),
    },
  })

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    videoModel: modelId,
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
    case TASK_TYPE.VIDEO_SEAM_CONCAT:
      return await handleVideoSeamConcatTask(job)
    case TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE:
      return await handleEnvironmentSoundAnalyzeTask(job)
    case TASK_TYPE.ENVIRONMENT_SOUND_GENERATE:
      return await handleEnvironmentSoundGenerateTask(job)
    case TASK_TYPE.ENVIRONMENT_SOUND_CLEANUP:
      return await handleEnvironmentSoundCleanupTask(job)
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
