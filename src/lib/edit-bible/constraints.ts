export const EDIT_BIBLE_STATUS = {
  PENDING: 'pending',
  GENERATING: 'generating',
  READY_FOR_REVIEW: 'ready_for_review',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const

export type EditBibleStatus = (typeof EDIT_BIBLE_STATUS)[keyof typeof EDIT_BIBLE_STATUS]

export const EDIT_BIBLE_CHAPTER_LIMITS = {
  minDurationSec: 40,
  maxDurationSec: 120,
  maxSourceChars: 3_600,
  minSourceChars: 700,
} as const

export const EDIT_BIBLE_PROMPT_CACHE_MIN_CHARS = 1024
