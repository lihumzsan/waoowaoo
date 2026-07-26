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

// Skill resources are authored in this repository and reviewed with the code
// that reads them, so their size is an authoring concern rather than a runtime
// risk. Turn, read-concurrency, and paid-search bounds remain because they
// constrain model behaviour and external cost.
export const DEFAULT_CREATIVE_WORKER_BUDGETS = {
  maxTurns: 8,
  maxReadCalls: 12,
  maxWebSearchCalls: 4,
  maxInputChars: 300_000,
  maxOutputChars: 120_000,
} as const

export const CREATIVE_WORKER_HARD_LIMITS = {
  maxTurns: 16,
  maxReadCalls: 24,
  maxWebSearchCalls: 8,
  maxInputChars: 600_000,
  maxOutputChars: 240_000,
} as const
