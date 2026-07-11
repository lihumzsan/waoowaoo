export type RetryPolicy = {
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

export function computeRetryDelayMs(policy: RetryPolicy, attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt))
  return Math.min(policy.baseDelayMs * Math.pow(2, normalizedAttempt - 1), policy.maxDelayMs)
}

export const RETRY_POLICY = {
  llm: { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
  llmStream: { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
  providerSubmit: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  mediaFetch: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 8000 },
  mediaPoll: { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 5000 },
  storage: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 2000 },
  prisma: { maxAttempts: 3, baseDelayMs: 80, maxDelayMs: 320 },
} as const satisfies Record<string, RetryPolicy>
