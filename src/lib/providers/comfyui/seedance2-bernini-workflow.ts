export const COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID = 'basevideo/seedance2/bernini-480p-i2v'
export const COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID = 'basevideo/seedance2/bernini-480p-i2v-audio-lipsync'
export const COMFYUI_SEEDANCE2_BERNINI_MODEL_KEY = `comfyui::${COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID}`
export const COMFYUI_SEEDANCE2_BERNINI_AUDIO_MODEL_KEY = `comfyui::${COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID}`

export const SEEDANCE2_BERNINI_DEFAULT_DURATION_SECONDS = 10
export const SEEDANCE2_BERNINI_DEFAULT_FPS = 24
export const SEEDANCE2_BERNINI_DEFAULT_MOTION_STRENGTH = 1
export const SEEDANCE2_BERNINI_MOTION_STRENGTH_OPTIONS = [1, 2, 3] as const

export type Seedance2BerniniMotionStrength = typeof SEEDANCE2_BERNINI_MOTION_STRENGTH_OPTIONS[number]

function normalizeWorkflowLikeKey(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim().replace(/\\/g, '/')
  return trimmed.startsWith('comfyui::') ? trimmed.slice('comfyui::'.length) : trimmed
}

export function isSeedance2BerniniWorkflowKey(raw: string | null | undefined): boolean {
  const normalized = normalizeWorkflowLikeKey(raw)
  return normalized === COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID
    || normalized === COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID
}

export function isSeedance2BerniniAudioWorkflowKey(raw: string | null | undefined): boolean {
  return normalizeWorkflowLikeKey(raw) === COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID
}

export function resolveSeedance2BerniniWorkflowKey(params: {
  requestedWorkflowKey: string
  hasReferenceAudio: boolean
}): string {
  if (!isSeedance2BerniniWorkflowKey(params.requestedWorkflowKey)) {
    return params.requestedWorkflowKey
  }
  return params.hasReferenceAudio
    ? COMFYUI_SEEDANCE2_BERNINI_AUDIO_WORKFLOW_ID
    : COMFYUI_SEEDANCE2_BERNINI_WORKFLOW_ID
}

export function normalizeSeedance2BerniniMotionStrength(value: unknown): Seedance2BerniniMotionStrength {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SEEDANCE2_BERNINI_DEFAULT_MOTION_STRENGTH
  }
  const normalized = Math.round(value)
  return SEEDANCE2_BERNINI_MOTION_STRENGTH_OPTIONS.includes(normalized as Seedance2BerniniMotionStrength)
    ? normalized as Seedance2BerniniMotionStrength
    : SEEDANCE2_BERNINI_DEFAULT_MOTION_STRENGTH
}

export function resolveSeedance2BerniniMotionStrengthLabel(value: Seedance2BerniniMotionStrength): string {
  if (value === 1) return 'calm / subtle motion'
  if (value === 3) return 'strong motion / intense action'
  return 'normal motion'
}
