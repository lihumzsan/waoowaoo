export const CREATIVE_WORK_OUTPUT_KINDS = [
  'screenplay',
  'chapter_continuity_plan',
  'creative_direction',
  'asset_manifest',
  'video_prompt_set',
  'music_direction',
] as const

export const CREATIVE_WORK_CONSTRAINT_LIMIT = 64

// Skill resources are authored in this repository and reviewed with the code
// that reads them, so their size is an authoring concern rather than a runtime
// risk. Turn, read-concurrency, and paid-search bounds remain because they
// constrain model behaviour and external cost.
export const DEFAULT_CREATIVE_WORKER_BUDGETS = {
  maxTurns: 8,
  maxReadCalls: 12,
  // A research gap that still changes the six domains must be answerable by a
  // second, narrower call, and a candidate set explores several directions from
  // the same frozen budget. This is a ceiling, not a quota: unused calls cost
  // nothing, so it is sized for the deepest legitimate run.
  maxWebSearchCalls: 6,
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
