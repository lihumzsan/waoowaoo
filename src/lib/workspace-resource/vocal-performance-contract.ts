import { z } from 'zod'

export const VOCAL_PERFORMANCE_MODES = [
  'native_dialogue',
  'lip_sync_for_replacement',
  'voiceover',
  'silent_no_lip',
] as const

export type VocalPerformanceMode = (typeof VOCAL_PERFORMANCE_MODES)[number]

export const vocalPerformanceModeSchema = z.enum(VOCAL_PERFORMANCE_MODES)

export function resolveVideoVocalPerformanceMode(input: {
  readonly projectDefault?: VocalPerformanceMode | null
  readonly itemOverride?: VocalPerformanceMode | null
}): VocalPerformanceMode {
  return input.itemOverride ?? input.projectDefault ?? 'native_dialogue'
}

export function assertVocalPerformancePrompt(input: {
  readonly mode: VocalPerformanceMode
  readonly prompt: string
}): void {
  if (input.mode === 'silent_no_lip' && /<\/?d>|<cutoff>/u.test(input.prompt)) {
    throw new Error('VIDEO_SILENT_NO_LIP_PROMPT_CONTAINS_DIALOGUE')
  }
}
