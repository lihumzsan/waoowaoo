import {
  parseVideoDurationBinding,
  resolveAudioDrivenVideoTiming,
  type VideoDurationBinding,
} from '@/lib/video-duration/audio-binding'
import { pickPanelContinuityBasePrompt, type PanelContinuityPanelLike } from '@/lib/novel-promotion/panel-continuity'

export type VideoReadinessIssueCode =
  | 'missing_image'
  | 'missing_prompt'
  | 'audio_duration_exceeds_model'
  | 'audio_duration_too_short'
  | 'short_dialogue_audio_too_long'

export type VideoReadinessIssue = {
  code: VideoReadinessIssueCode
  message: string
  details?: Record<string, unknown>
}

export type VideoReadinessVoiceLine = {
  id: string
  content?: string | null
  audioDuration?: number | null
}

export type VideoReadinessPanelLike = PanelContinuityPanelLike & {
  imageUrl?: string | null
  videoDurationBinding?: unknown
  matchedVoiceLines?: VideoReadinessVoiceLine[] | null
  storyboard?: {
    clip?: {
      content?: string | null
    } | null
  } | null
}

const SHORT_DIALOGUE_CHARACTER_LIMIT = 6
const SHORT_DIALOGUE_LONG_AUDIO_MS = 5_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readPayloadCustomPrompt(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.customPrompt !== 'string') return null
  const normalized = payload.customPrompt.trim()
  return normalized ? normalized : null
}

function readPayloadDurationBinding(payload: unknown): VideoDurationBinding | null {
  if (!isRecord(payload)) return null
  const raw = payload.videoDurationBinding
  if (!isRecord(raw)) return null
  return parseVideoDurationBinding(raw)
}

function resolveEffectiveBinding(
  panel: VideoReadinessPanelLike,
  payload: unknown,
): VideoDurationBinding {
  const payloadBinding = readPayloadDurationBinding(payload)
  if (payloadBinding?.mode === 'match_audio' && (payloadBinding.voiceLineIds || []).length > 0) {
    return payloadBinding
  }

  const savedBinding = parseVideoDurationBinding(panel.videoDurationBinding)
  if (savedBinding.mode === 'match_audio' && (savedBinding.voiceLineIds || []).length > 0) {
    return savedBinding
  }

  const autoVoiceLineIds = (panel.matchedVoiceLines || [])
    .filter((line) => typeof line.audioDuration === 'number' && Number.isFinite(line.audioDuration) && line.audioDuration > 0)
    .map((line) => line.id)

  return autoVoiceLineIds.length > 0
    ? { mode: 'match_audio', voiceLineIds: autoVoiceLineIds }
    : savedBinding
}

function normalizeDialogueLength(text: string | null | undefined): number {
  if (!text) return 0
  return Array.from(text.replace(/[\s"'“”‘’「」『』.,，。！？!?…:：;；、\-—_]/g, '')).length
}

function findSelectedVoiceLines(
  panel: VideoReadinessPanelLike,
  binding: VideoDurationBinding,
): VideoReadinessVoiceLine[] {
  if (binding.mode !== 'match_audio') return []
  const selected = Array.isArray(binding.voiceLineIds) ? binding.voiceLineIds : []
  if (selected.length === 0) return []
  const selectedSet = new Set(selected)
  return (panel.matchedVoiceLines || []).filter((line) => selectedSet.has(line.id))
}

export function resolvePanelVideoReadinessIssue(
  panel: VideoReadinessPanelLike,
  options?: {
    payload?: unknown
    modelKey?: string | null
    durationOptions?: readonly number[] | null
    fpsOptions?: readonly number[] | null
  },
): VideoReadinessIssue | null {
  if (!panel.imageUrl) {
    return {
      code: 'missing_image',
      message: 'Panel has no generated image.',
    }
  }

  const basePrompt = readPayloadCustomPrompt(options?.payload) || pickPanelContinuityBasePrompt(panel)
  if (!basePrompt) {
    return {
      code: 'missing_prompt',
      message: 'Panel has no usable video prompt, description, or source text.',
    }
  }

  const binding = resolveEffectiveBinding(panel, options?.payload)
  const selectedVoiceLines = findSelectedVoiceLines(panel, binding)
  if (selectedVoiceLines.length === 0) return null

  const tooShortAudio = selectedVoiceLines.find((line) =>
    typeof line.audioDuration === 'number'
    && Number.isFinite(line.audioDuration)
    && line.audioDuration > 0
    && line.audioDuration < 600)
  if (tooShortAudio) {
    return {
      code: 'audio_duration_too_short',
      message: 'Matched audio is too short for stable video timing.',
      details: {
        voiceLineId: tooShortAudio.id,
        audioDurationMs: tooShortAudio.audioDuration,
      },
    }
  }

  const shortDialogueLongAudio = selectedVoiceLines.find((line) =>
    typeof line.audioDuration === 'number'
    && Number.isFinite(line.audioDuration)
    && line.audioDuration > SHORT_DIALOGUE_LONG_AUDIO_MS
    && normalizeDialogueLength(line.content) > 0
    && normalizeDialogueLength(line.content) <= SHORT_DIALOGUE_CHARACTER_LIMIT)

  const timing = resolveAudioDrivenVideoTiming({
    binding,
    candidates: selectedVoiceLines.map((line) => ({
      id: line.id,
      content: line.content,
      audioDuration: line.audioDuration,
    })),
    modelKey: options?.modelKey,
    durationOptions: options?.durationOptions,
    fpsOptions: options?.fpsOptions,
    context: {
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      sceneType: panel.sceneType,
      clipContent: panel.storyboard?.clip?.content ?? null,
      srtSegment: panel.srtSegment,
    },
  })

  if (timing && !timing.canGenerate) {
    return {
      code: 'audio_duration_exceeds_model',
      message: 'Matched audio exceeds the selected video workflow duration.',
      details: {
        audioDurationSeconds: timing.audioDurationSeconds,
        maxDurationSeconds: timing.maxDurationSeconds,
        blockedReason: timing.blockedReason,
      },
    }
  }

  if (shortDialogueLongAudio) {
    return {
      code: 'short_dialogue_audio_too_long',
      message: 'Short dialogue is bound to unusually long audio and needs manual confirmation.',
      details: {
        voiceLineId: shortDialogueLongAudio.id,
        audioDurationMs: shortDialogueLongAudio.audioDuration,
        text: shortDialogueLongAudio.content,
      },
    }
  }

  return null
}

export function summarizeVideoReadinessIssues(issues: Array<VideoReadinessIssue | null>): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const issue of issues) {
    if (!issue) continue
    summary[issue.code] = (summary[issue.code] || 0) + 1
  }
  return summary
}
