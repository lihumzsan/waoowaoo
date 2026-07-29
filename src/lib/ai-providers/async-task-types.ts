import type { AiLlmProviderConfig } from '@/lib/ai-registry/types'

export type AsyncExternalIdProvider =
  | 'FAL'
  | 'ARK'
  | 'GEMINI'
  | 'GOOGLE'
  | 'OPENROUTER'
  | 'MUREKA'

export type AsyncExternalIdType = 'VIDEO' | 'IMAGE' | 'MUSIC' | 'VOICE' | 'BATCH'

export interface AsyncDownloadHeaders {
  [name: string]: string
}

type AsyncPollResultFields = {
  resultUrl?: string
  imageUrl?: string
  videoUrl?: string
  actualVideoTokens?: number
  downloadHeaders?: AsyncDownloadHeaders
  error?: string
}

/**
 * Pending sub-phase reported by the provider queue protocol.
 * `queued`: accepted but not yet started (provider queue position wait).
 * `running`: the model is actually executing.
 * Providers that cannot distinguish the two omit the field; consumers must
 * treat an absent phase as `running` so the generation timeout budget applies.
 */
export type AsyncPendingPhase = 'queued' | 'running'

export type AsyncPollResult = AsyncPollResultFields & (
  | {
    status: 'pending'
    pendingPhase?: AsyncPendingPhase
    failureDisposition?: never
  }
  | {
    status: 'completed'
    pendingPhase?: never
    failureDisposition?: never
  }
  | {
    status: 'failed'
    pendingPhase?: never
    failureDisposition: 'retryable' | 'permanent'
  }
)

export function normalizeAsyncPollResult(input: AsyncPollResultFields & {
  readonly status: 'pending' | 'completed' | 'failed'
  readonly pendingPhase?: AsyncPendingPhase
  readonly failureDisposition?: 'retryable' | 'permanent'
}): AsyncPollResult {
  if (input.status !== 'pending' && input.pendingPhase) {
    throw new Error('ASYNC_PROVIDER_PENDING_PHASE_FORBIDDEN')
  }
  if (input.status === 'failed') {
    if (!input.failureDisposition) throw new Error('ASYNC_PROVIDER_FAILURE_DISPOSITION_REQUIRED')
    return input as AsyncPollResult
  }
  if (input.failureDisposition) throw new Error('ASYNC_PROVIDER_NON_FAILURE_DISPOSITION_FORBIDDEN')
  return input as AsyncPollResult
}

export interface ParsedAsyncExternalId {
  provider: AsyncExternalIdProvider
  type: AsyncExternalIdType
  endpoint?: string
  requestId: string
  providerToken?: string
  modelKeyToken?: string
}

export interface FormatAsyncExternalIdInput {
  type: AsyncExternalIdType
  requestId: string
  endpoint?: string
  providerToken?: string
  modelKeyToken?: string
}

export interface AsyncUserModelForPolling {
  modelKey: string
  modelId: string
}

export interface AsyncTaskPollContext {
  userId: string
  getProviderConfig: (userId: string, providerId: string) => Promise<AiLlmProviderConfig>
  getUserModels: (userId: string) => Promise<AsyncUserModelForPolling[]>
}

export interface AsyncTaskPollInput {
  parsed: ParsedAsyncExternalId
  context: AsyncTaskPollContext
}

export interface AsyncTaskProviderRegistration {
  providerCode: AsyncExternalIdProvider
  canParseExternalId: (externalId: string) => boolean
  parseExternalId: (externalId: string) => ParsedAsyncExternalId
  formatExternalId: (input: FormatAsyncExternalIdInput) => string
  poll: (input: AsyncTaskPollInput) => Promise<AsyncPollResult>
  /**
   * Optional provider-side cancellation of an accepted-but-unfinished job.
   * Declared here so shared callers dispatch by registry capability instead of
   * guessing by provider name. Implementations must be idempotent and treat
   * "already terminal / unknown request" (4xx) as a tolerated no-op; only
   * transport/5xx failures may throw. Any provider that reports
   * `pendingPhase: 'queued'` must declare cancel so queue-timeout compensation
   * can supersede the stuck job.
   */
  cancel?: (input: AsyncTaskPollInput) => Promise<void>
}
