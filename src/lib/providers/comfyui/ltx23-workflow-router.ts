import {
  COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID,
  COMFYUI_LTX23_WORKFLOW_KEYS,
  getLtx23WorkflowProfile,
  isComfyUiLtx23GoonFirstLastFrameWorkflow,
  normalizeLtx23GoonDurationSeconds,
  normalizeLtx23WorkflowKey,
  type Ltx23WorkflowProfile,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'

export type Ltx23WorkflowSelectionMode = 'auto' | 'manual'
export type Ltx23WorkflowGenerationMode = 'normal' | 'firstlastframe'

export type Ltx23WorkflowRoutingPanelContext = {
  videoPrompt?: string | null
  description?: string | null
  shotType?: string | null
  cameraMove?: string | null
  sceneType?: string | null
  srtSegment?: string | null
  clipContent?: string | null
}

export type ResolveLtx23WorkflowRouteInput = {
  modelKey?: string | null
  selectionMode?: unknown
  generationMode?: unknown
  panel?: Ltx23WorkflowRoutingPanelContext | null
  requestedDurationSeconds?: number | null
  audioDurationSeconds?: number | null
  targetDurationSeconds?: number | null
  hasReferenceAudio?: boolean | null
}

export type Ltx23WorkflowRoutingResult = {
  selectedWorkflowKey: string
  selectedModelKey: string
  profile: Ltx23WorkflowProfile
  selectionMode: Ltx23WorkflowSelectionMode
  routed: boolean
  confidence: number
  reasons: string[]
  durationSeconds: number
  fps: number
}

const COMFYUI_MODEL_KEY_PREFIX = 'comfyui::'

const MICRO_DETAIL_PATTERNS = [
  /微表情/u,
  /细节/u,
  /眨眼/u,
  /眼神/u,
  /抬眼/u,
  /垂眸/u,
  /嘴角/u,
  /嘴型/u,
  /口型/u,
  /皱眉/u,
  /流泪/u,
  /轻微/u,
  /手指/u,
  /指尖/u,
  /呼吸/u,
  /\bblink(?:s|ing)?\b/i,
  /\beye\s*(?:movement|contact|glance)\b/i,
  /\bglance(?:s|d|ing)?\b/i,
  /\bmicro[-\s]?expression\b/i,
  /\bsubtle\b/i,
  /\bfinger(?:s|tip)?\b/i,
  /\bmouth\b/i,
  /\blip(?:s)?\b/i,
]

const SLOW_STABLE_CAMERA_PATTERNS = [
  /\u955c\u5934.{0,12}\u7f13(?:\u6162|\u7f13).{0,12}\u63a8(?:\u8fdb|\u8fd1)/u,
  /\u7f13(?:\u6162|\u7f13).{0,12}\u63a8(?:\u8fdb|\u8fd1)/u,
  /(?:\u7f13\u6162|\u7ec6\u5fae|\u6781\u8f7b|\u6781\u8f7b\u5fae|\u51e0\u4e4e\u4e0d\u53ef\u5bdf\u89c9).{0,80}(?:\u538b\u8fd1|\u63a8\u8fdb|\u63a8\u8fd1|\u7a33\u5b9a|\u6784\u56fe)/u,
  /\u7a33\u5b9a\u6784\u56fe.{0,120}(?:\u514b\u5236|\u8f7b\u5fae|\u7ec6\u5fae|\u6781\u7ec6\u5c0f)/u,
  /\u4fdd\u6301.{0,80}(?:\u6e90\u56fe|\u6784\u56fe|\u673a\u4f4d).{0,80}(?:\u7f13\u6162|\u7a33\u5b9a|\u63a8\u8fdb|\u538b\u8fd1)/u,
  /\b(?:very\s+)?subtle\s+(?:slow\s+)?(?:push[-\s]?in|dolly|zoom)\b/i,
  /\bslow\s+(?:push[-\s]?in|dolly|zoom)\b/i,
  /\bstable\s+composition\b.{0,160}\b(?:subtle|tiny|restrained|minimal|slow)\b/i,
]

const HIGH_MOTION_ACTION_PATTERNS = [
  /\u7a81\u7136/u,
  /\u5feb\u901f/u,
  /\u5927\u5e45/u,
  /\u5267\u70c8/u,
  /\u660e\u663e\u53d8\u5316/u,
  /\u5954\u8dd1/u,
  /\u8dd1/u,
  /\u51b2/u,
  /\u8f6c\u8eab/u,
  /\u8d77\u8eab/u,
  /\u7ad9\u8d77/u,
  /\u8d70\u8fd1/u,
  /\u8d70\u5411/u,
  /\u9760\u8fd1/u,
  /\u79bb\u5f00/u,
  /\u8dcc\u5012/u,
  /\u6454\u5012/u,
  /\u6253\u6597/u,
  /\u6325\u62f3/u,
  /\u8df3/u,
  /\brun(?:s|ning)?\b/i,
  /\bsprint(?:s|ing)?\b/i,
  /\bchase(?:s|d|ing)?\b/i,
  /\bturn(?:s|ed|ing)?\b/i,
  /\bstand(?:s|ing)?\s+up\b/i,
  /\bwalk(?:s|ing)?\s+(?:toward|forward|away)\b/i,
  /\bapproach(?:es|ed|ing)?\b/i,
  /\bleav(?:es|ing|e)\b/i,
  /\bfall(?:s|en|ing)?\b/i,
  /\bfight(?:s|ing)?\b/i,
  /\bjump(?:s|ing)?\b/i,
]

const LARGE_MOTION_PATTERNS = [
  /\u955c\u5934.{0,12}\u7f13(?:\u6162|\u7f13).{0,8}\u63a8(?:\u8fdb|\u8fd1)/u,
  /\u7f13(?:\u6162|\u7f13).{0,8}\u63a8(?:\u8fdb|\u8fd1)/u,
  /\u955c\u5934.{0,8}\u63a8(?:\u8fdb|\u8fd1)/u,
  /\u63a8\u8fdb/u,
  /\u63a8\u8fd1/u,
  /大幅/u,
  /剧烈/u,
  /明显变化/u,
  /跑/u,
  /奔跑/u,
  /冲/u,
  /追/u,
  /转身/u,
  /起身/u,
  /站起/u,
  /走近/u,
  /走向/u,
  /靠近/u,
  /离开/u,
  /跌倒/u,
  /摔倒/u,
  /跳/u,
  /打斗/u,
  /挥拳/u,
  /推近/u,
  /拉远/u,
  /平移/u,
  /跟拍/u,
  /环绕/u,
  /运镜/u,
  /\brun(?:s|ning)?\b/i,
  /\bsprint(?:s|ing)?\b/i,
  /\bchase(?:s|d|ing)?\b/i,
  /\bturn(?:s|ed|ing)?\b/i,
  /\bstand(?:s|ing)?\s+up\b/i,
  /\bwalk(?:s|ing)?\s+(?:toward|forward|away)\b/i,
  /\bapproach(?:es|ed|ing)?\b/i,
  /\bleav(?:es|ing|e)\b/i,
  /\bfall(?:s|en|ing)?\b/i,
  /\bfight(?:s|ing)?\b/i,
  /\bjump(?:s|ing)?\b/i,
  /\bpush[-\s]?in\b/i,
  /\bpull[-\s]?back\b/i,
  /\bpan(?:s|ning)?\b/i,
  /\btrack(?:s|ing)?\b/i,
  /\bdolly\b/i,
  /\bzoom(?:s|ing)?\b/i,
  /\borbit(?:s|ing)?\b/i,
]

const PROMPT_RELAY_PATTERNS = [
  /promptrelay/i,
  /\bglobal\s*:/i,
  /\blocal\s*:/i,
  /\bscene\s*\d+\s*[:：]/i,
  /镜头\s*\d+\s*[:：]/u,
  /分镜\s*\d+\s*[:：]/u,
  /多阶段/u,
  /分阶段/u,
  /逐渐/u,
  /随后/u,
  /接着/u,
  /然后/u,
  /最后/u,
]

const COMPLEX_FALLBACK_PATTERNS = [
  /首中尾/u,
  /多图/u,
  /三段/u,
  /复杂/u,
  /同时/u,
  /\baio\b/i,
  /\bcomplex\b/i,
]

function toComfyUiModelKey(workflowKey: string): string {
  return `${COMFYUI_MODEL_KEY_PREFIX}${workflowKey}`
}

function readFinitePositiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function resolveTargetDurationSeconds(input: ResolveLtx23WorkflowRouteInput): number | null {
  const durations = [
    readFinitePositiveNumber(input.targetDurationSeconds),
    readFinitePositiveNumber(input.requestedDurationSeconds),
    readFinitePositiveNumber(input.audioDurationSeconds),
  ].filter((value): value is number => value !== null)
  if (durations.length === 0) return null
  return Math.max(...durations)
}

function normalizeSelectionMode(raw: unknown, normalizedWorkflowKey: string): Ltx23WorkflowSelectionMode {
  if (raw === 'auto' || raw === true) return 'auto'
  if (raw === 'manual' || raw === false) return 'manual'
  return normalizedWorkflowKey === COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID ? 'auto' : 'manual'
}

function normalizeGenerationMode(raw: unknown): Ltx23WorkflowGenerationMode {
  return raw === 'firstlastframe' ? 'firstlastframe' : 'normal'
}

function joinPanelText(panel: Ltx23WorkflowRoutingPanelContext | null | undefined): string {
  if (!panel) return ''
  return [
    panel.videoPrompt,
    panel.description,
    panel.shotType,
    panel.cameraMove,
    panel.sceneType,
    panel.srtSegment,
    panel.clipContent,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
}

function countMatches(text: string, patterns: RegExp[]): number {
  if (!text) return 0
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
}

function pickProfile(workflowKey: string): Ltx23WorkflowProfile {
  const profile = getLtx23WorkflowProfile(workflowKey)
  if (!profile) {
    throw new Error(`LTX23_WORKFLOW_PROFILE_NOT_FOUND: ${workflowKey}`)
  }
  return profile
}

function buildResult(params: {
  workflowKey: string
  previousWorkflowKey: string
  selectionMode: Ltx23WorkflowSelectionMode
  confidence: number
  reasons: string[]
  requestedDurationSeconds: number | null
}): Ltx23WorkflowRoutingResult {
  const profile = pickProfile(params.workflowKey)
  const durationSeconds = isComfyUiLtx23GoonFirstLastFrameWorkflow(profile.workflowKey)
    ? normalizeLtx23GoonDurationSeconds(params.requestedDurationSeconds)
    : params.requestedDurationSeconds !== null
      ? params.requestedDurationSeconds
      : profile.defaultDurationSeconds

  return {
    selectedWorkflowKey: profile.workflowKey,
    selectedModelKey: toComfyUiModelKey(profile.workflowKey),
    profile,
    selectionMode: params.selectionMode,
    routed: params.previousWorkflowKey !== profile.workflowKey,
    confidence: params.confidence,
    reasons: params.reasons,
    durationSeconds,
    fps: profile.fps,
  }
}

export function resolveLtx23WorkflowRoute(
  input: ResolveLtx23WorkflowRouteInput,
): Ltx23WorkflowRoutingResult | null {
  const normalizedWorkflowKey = normalizeLtx23WorkflowKey(input.modelKey)
  const currentProfile = getLtx23WorkflowProfile(normalizedWorkflowKey)
  if (!currentProfile) return null

  const targetDurationSeconds = resolveTargetDurationSeconds(input)
  const generationMode = normalizeGenerationMode(input.generationMode)
  const firstLastFrameModelInNormalMode =
    generationMode === 'normal' && currentProfile.category === 'first_last_frame'
  const routingProfile = firstLastFrameModelInNormalMode
    ? getLtx23WorkflowProfile(COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID)
    : currentProfile
  if (!routingProfile) return null

  const selectionMode: Ltx23WorkflowSelectionMode = firstLastFrameModelInNormalMode
    ? 'auto'
    : normalizeSelectionMode(input.selectionMode, normalizedWorkflowKey)
  const routingReasonPrefix = firstLastFrameModelInNormalMode
    ? ['first_last_frame_model_in_normal_mode']
    : []

  if (generationMode === 'firstlastframe') {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: 1,
      reasons: [...routingReasonPrefix, 'first_last_frame_generation'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  if (selectionMode === 'manual') {
    return buildResult({
      workflowKey: routingProfile.workflowKey,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: 1,
      reasons: [...routingReasonPrefix, 'manual_selection'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  const hasReferenceAudio =
    input.hasReferenceAudio === true
    || readFinitePositiveNumber(input.audioDurationSeconds) !== null
  if (
    hasReferenceAudio
    && routingProfile.workflowKey === COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise
  ) {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: 1,
      reasons: [...routingReasonPrefix, 'audio_backed_smart_vbvr'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  const text = joinPanelText(input.panel)
  const microScore = countMatches(text, MICRO_DETAIL_PATTERNS)
  const slowStableCameraScore = countMatches(text, SLOW_STABLE_CAMERA_PATTERNS)
  const highMotionActionScore = countMatches(text, HIGH_MOTION_ACTION_PATTERNS)
  const largeMotionScore = countMatches(text, LARGE_MOTION_PATTERNS)
  const promptRelayScore = countMatches(text, PROMPT_RELAY_PATTERNS)
  const fallbackScore = countMatches(text, COMPLEX_FALLBACK_PATTERNS)
  const slowStableDurationSeconds = Math.max(targetDurationSeconds ?? 0, 12)
  const largeMotionDurationSeconds = Math.max(targetDurationSeconds ?? 0, 12)
  const slowStableProfile = getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise)
  const largeMotionProfile = getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion)
  const hasLongPromptRelayStructure = targetDurationSeconds !== null
    && targetDurationSeconds > 12
    && promptRelayScore >= 2

  if (
    slowStableCameraScore > 0
    && highMotionActionScore === 0
    && !hasLongPromptRelayStructure
    && (
      slowStableProfile?.maxDurationSeconds === null
      || slowStableDurationSeconds <= (slowStableProfile?.maxDurationSeconds ?? 0)
    )
  ) {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: slowStableCameraScore >= 2 ? 0.92 : 0.86,
      reasons: [...routingReasonPrefix, 'slow_stable_camera_movement'],
      requestedDurationSeconds: slowStableDurationSeconds,
    })
  }

  if (
    largeMotionScore > 0
    && !hasLongPromptRelayStructure
    && (
      largeMotionProfile?.maxDurationSeconds === null
      || largeMotionDurationSeconds <= (largeMotionProfile?.maxDurationSeconds ?? 0)
    )
  ) {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: largeMotionScore >= 2 ? 0.9 : 0.82,
      reasons: [...routingReasonPrefix, 'large_motion_or_camera_movement'],
      requestedDurationSeconds: largeMotionDurationSeconds,
    })
  }

  if (targetDurationSeconds !== null && targetDurationSeconds > 24) {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: 0.98,
      reasons: [...routingReasonPrefix, 'duration_over_24s'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  if (targetDurationSeconds !== null && targetDurationSeconds > 12) {
    const workflowKey = promptRelayScore > 0 && targetDurationSeconds <= 24
      ? COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay
      : COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s
    return buildResult({
      workflowKey,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: promptRelayScore > 0 ? 0.94 : 0.92,
      reasons: promptRelayScore > 0
        ? [...routingReasonPrefix, 'duration_over_12s', 'promptrelay_or_multi_stage']
        : [...routingReasonPrefix, 'duration_over_12s'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  if (microScore > 0) {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.microDetail,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: microScore >= 2 ? 0.88 : 0.78,
      reasons: [...routingReasonPrefix, 'micro_detail_or_expression'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  if (fallbackScore >= 2 || (promptRelayScore >= 2 && !targetDurationSeconds)) {
    return buildResult({
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2,
      previousWorkflowKey: normalizedWorkflowKey,
      selectionMode,
      confidence: 0.62,
      reasons: [...routingReasonPrefix, 'complex_low_confidence_fallback'],
      requestedDurationSeconds: targetDurationSeconds,
    })
  }

  return buildResult({
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
    previousWorkflowKey: normalizedWorkflowKey,
    selectionMode,
    confidence: 0.7,
    reasons: [...routingReasonPrefix, 'default_single_image_precise'],
    requestedDurationSeconds: targetDurationSeconds,
  })
}

export function resolveLtx23WorkflowModelKey(
  input: ResolveLtx23WorkflowRouteInput,
): string | null {
  return resolveLtx23WorkflowRoute(input)?.selectedModelKey ?? null
}
