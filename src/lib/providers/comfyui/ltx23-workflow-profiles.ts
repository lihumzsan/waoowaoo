export const COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID =
  'basevideo/ltx23-profiles/goon-first-last-frame-2stage'
export const COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_MODEL_KEY =
  `comfyui::${COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID}`
export const COMFYUI_LTX23_GOON_DURATION_OPTIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const
export const COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS = 10
export const COMFYUI_LTX23_GOON_FPS = 24

export const COMFYUI_LTX23_WORKFLOW_KEYS = {
  singleImagePrecise: 'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
  microDetail: 'basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro',
  singleImageLargeMotion: 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
  goonFirstLastFrame: COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID,
  damaichaImageTo30s: 'basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
  damaichaLongPromptRelay: 'basevideo/ltx23-profiles/damaicha-long-video-promptrelay',
  damaichaAioV2: 'basevideo/ltx23-profiles/damaicha-aio-v2-no-subtitles',
} as const

export const COMFYUI_LTX23_DEFAULT_VIDEO_WORKFLOW_ID = COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise

export type Ltx23WorkflowCategory =
  | 'single_image_precise'
  | 'micro_detail'
  | 'single_image_large_motion'
  | 'first_last_frame'
  | 'long_video'
  | 'aio_fallback'

export type Ltx23PromptPolicy =
  | 'stable_single_image'
  | 'micro_detail'
  | 'large_motion_single_image'
  | 'first_last_frame'
  | 'long_promptrelay'
  | 'aio'

export type Ltx23ImageSlotPolicy =
  | 'single'
  | 'repeat_single_to_four'
  | 'repeat_single_to_three'
  | 'first_last'

export type Ltx23WorkflowProfile = {
  workflowKey: string
  label: string
  category: Ltx23WorkflowCategory
  promptPolicy: Ltx23PromptPolicy
  imageSlotPolicy: Ltx23ImageSlotPolicy
  maxDurationSeconds: number | null
  defaultDurationSeconds: number
  durationOptions: number[]
  fps: number
  selectableInPanel: boolean
}

const LTX23_WORKFLOW_PROFILES: Record<string, Ltx23WorkflowProfile> = {
  [COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
    label: 'ComfyUI · LTX2.3 单图精准 Smart VBVR',
    category: 'single_image_precise',
    promptPolicy: 'stable_single_image',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 20,
    defaultDurationSeconds: 19.56,
    durationOptions: [4, 5, 6, 8, 10, 12, 16, 20],
    fps: 25,
    selectableInPanel: true,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.microDetail]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.microDetail,
    label: 'ComfyUI · LTX2.3 微表情 Sulphur2',
    category: 'micro_detail',
    promptPolicy: 'micro_detail',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 12,
    defaultDurationSeconds: 6,
    durationOptions: [4, 5, 6, 8, 10, 12],
    fps: 25,
    selectableInPanel: true,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImageLargeMotion,
    label: 'ComfyUI · LTX2.3 单图大幅变化四段控制',
    category: 'single_image_large_motion',
    promptPolicy: 'large_motion_single_image',
    imageSlotPolicy: 'repeat_single_to_four',
    maxDurationSeconds: 20,
    defaultDurationSeconds: 16,
    durationOptions: [12, 16, 20],
    fps: 25,
    selectableInPanel: true,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame,
    label: 'ComfyUI · LTX2.3 Goon 首尾帧两阶段',
    category: 'first_last_frame',
    promptPolicy: 'first_last_frame',
    imageSlotPolicy: 'first_last',
    maxDurationSeconds: 15,
    defaultDurationSeconds: COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS,
    durationOptions: [...COMFYUI_LTX23_GOON_DURATION_OPTIONS],
    fps: COMFYUI_LTX23_GOON_FPS,
    selectableInPanel: true,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaImageTo30s,
    label: 'ComfyUI · LTX2.3 大麦茶图生30秒',
    category: 'long_video',
    promptPolicy: 'long_promptrelay',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 30,
    defaultDurationSeconds: 20,
    durationOptions: [12, 16, 20, 24, 30],
    fps: 25,
    selectableInPanel: true,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaLongPromptRelay,
    label: 'ComfyUI · LTX2.3 大麦茶长视频 PromptRelay',
    category: 'long_video',
    promptPolicy: 'long_promptrelay',
    imageSlotPolicy: 'single',
    maxDurationSeconds: 24,
    defaultDurationSeconds: 16,
    durationOptions: [12, 16, 20, 24],
    fps: 25,
    selectableInPanel: true,
  },
  [COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2]: {
    workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.damaichaAioV2,
    label: 'ComfyUI · LTX2.3 大麦茶 AIO V2 无字幕',
    category: 'aio_fallback',
    promptPolicy: 'aio',
    imageSlotPolicy: 'repeat_single_to_three',
    maxDurationSeconds: 12,
    defaultDurationSeconds: 8,
    durationOptions: [6, 8, 10, 12],
    fps: 25,
    selectableInPanel: true,
  },
}

function copyLtx23WorkflowProfile(profile: Ltx23WorkflowProfile): Ltx23WorkflowProfile {
  return {
    ...profile,
    durationOptions: [...profile.durationOptions],
  }
}

export function getLtx23WorkflowProfiles(): Ltx23WorkflowProfile[] {
  return Object.values(LTX23_WORKFLOW_PROFILES).map(copyLtx23WorkflowProfile)
}

export function normalizeLtx23WorkflowKey(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim().replace(/^comfyui::/, '') : ''
}

export function getLtx23WorkflowProfile(rawWorkflowKey: string | null | undefined): Ltx23WorkflowProfile | null {
  const normalizedWorkflowKey = normalizeLtx23WorkflowKey(rawWorkflowKey)
  const profile = normalizedWorkflowKey ? LTX23_WORKFLOW_PROFILES[normalizedWorkflowKey] : null
  return profile ? copyLtx23WorkflowProfile(profile) : null
}

export function isComfyUiLtx23LongVideoWorkflow(rawWorkflowKey: string | null | undefined): boolean {
  return getLtx23WorkflowProfile(rawWorkflowKey)?.category === 'long_video'
}

export function isComfyUiLtx23GoonFirstLastFrameWorkflow(
  rawWorkflowKey: string | null | undefined,
): boolean {
  return normalizeLtx23WorkflowKey(rawWorkflowKey) === COMFYUI_LTX23_GOON_FIRST_LAST_FRAME_WORKFLOW_ID
}

export function normalizeLtx23GoonDurationSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS
  }
  return COMFYUI_LTX23_GOON_DURATION_OPTIONS.includes(
    raw as typeof COMFYUI_LTX23_GOON_DURATION_OPTIONS[number],
  )
    ? raw
    : COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS
}

export function resolveLtx23GoonFrameCount(durationSeconds: number): number {
  const normalizedDurationSeconds = normalizeLtx23GoonDurationSeconds(durationSeconds)
  return 1 + 8 * Math.round(
    (normalizedDurationSeconds * COMFYUI_LTX23_GOON_FPS) / 8,
  )
}

export function resolveLtx23GoonFinalFrameIndex(durationSeconds: number): number {
  return resolveLtx23GoonFrameCount(durationSeconds) - 1
}

export function expandLtx23WorkflowImageFilenames(
  rawWorkflowKey: string | null | undefined,
  imageFilenames: string[] | undefined,
): string[] | undefined {
  const profile = getLtx23WorkflowProfile(rawWorkflowKey)
  if (!profile) return imageFilenames

  const filenames = Array.isArray(imageFilenames)
    ? imageFilenames.filter((filename): filename is string => typeof filename === 'string' && filename.trim().length > 0)
    : []
  const firstImage = filenames[0]
  const lastImage = filenames[filenames.length - 1] ?? firstImage

  switch (profile.imageSlotPolicy) {
    case 'repeat_single_to_four':
      return firstImage ? [firstImage, firstImage, firstImage, firstImage] : []
    case 'repeat_single_to_three':
      return firstImage ? [firstImage, firstImage, firstImage] : []
    case 'first_last':
      return firstImage ? [firstImage, lastImage] : []
    case 'single':
    default:
      return firstImage ? [firstImage] : []
  }
}
