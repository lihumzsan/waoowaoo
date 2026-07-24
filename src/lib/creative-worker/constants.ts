export const CREATIVE_WORK_OUTPUT_KINDS = [
  'screenplay',
  'story_canon',
  'chapter_plan',
  'continuity_analysis',
  'creative_direction',
  'asset_manifest',
  'video_prompt_set',
  'music_direction',
  'creative_review',
] as const

export const DEFAULT_CREATIVE_WORKER_BUDGETS = {
  maxTurns: 8,
  maxReadCalls: 12,
  maxSkillContentChars: 80_000,
  maxSingleSkillResourceChars: 24_000,
  maxInputChars: 300_000,
  maxOutputChars: 120_000,
} as const

export const CREATIVE_WORKER_HARD_LIMITS = {
  maxTurns: 16,
  maxReadCalls: 24,
  maxSkillContentChars: 160_000,
  maxSingleSkillResourceChars: 48_000,
  maxInputChars: 600_000,
  maxOutputChars: 240_000,
} as const
