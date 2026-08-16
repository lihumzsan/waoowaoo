import { parseFailureRecord, type FailureRecord } from '@/lib/errors/failure'

export type AsyncExternalIdProvider =
  | 'COMFYUI'

export type AsyncExternalIdType = 'VIDEO' | 'IMAGE' | 'MUSIC' | 'SOUND' | 'VOICE' | 'BATCH'

export interface AsyncDownloadHeaders {
  [name: string]: string
}

type AsyncPollResultFields = {
  resultUrl?: string
  imageUrl?: string
  videoUrl?: string
  actualVideoTokens?: number
  downloadHeaders?: AsyncDownloadHeaders
}

/**
 * Pending sub-phase reported by the provider queue protocol.
 * `queued`: accepted but not yet started (provider queue position wait).
 * `running`: the model is actually executing.
 * Providers that cannot distinguish the two omit the field; consumers must
 * treat an absent phase as `running` so the generation timeout budget applies.
 */
export const ASYNC_PENDING_PHASES = ['queued', 'running'] as const

export type AsyncPendingPhase = (typeof ASYNC_PENDING_PHASES)[number]

export type AsyncPollResult = AsyncPollResultFields & (
  | {
    status: 'pending'
    pendingPhase?: AsyncPendingPhase
    failure?: never
  }
  | {
    status: 'completed'
    pendingPhase?: never
    failure?: never
  }
  | {
    status: 'failed'
    pendingPhase?: never
    failure: FailureRecord
  }
)

export function normalizeAsyncPollResult(input: AsyncPollResultFields & {
  readonly status: 'pending' | 'completed' | 'failed'
  readonly pendingPhase?: AsyncPendingPhase
  readonly failure?: FailureRecord
}): AsyncPollResult {
  if (input.status !== 'pending' && input.pendingPhase) {
    throw new Error('ASYNC_PROVIDER_PENDING_PHASE_FORBIDDEN')
  }
  if (input.status === 'failed') {
    if (!parseFailureRecord(input.failure)) throw new Error('ASYNC_PROVIDER_FAILURE_RECORD_REQUIRED')
    return input as AsyncPollResult
  }
  if (input.failure) throw new Error('ASYNC_PROVIDER_NON_FAILURE_RECORD_FORBIDDEN')
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
  getProviderConfig: (userId: string, providerId: string) => Promise<{
    id: string
    name: string
    apiKey: string
    baseUrl?: string
  }>
  getUserModels: (userId: string) => Promise<AsyncUserModelForPolling[]>
}

export interface AsyncTaskPollInput {
  parsed: ParsedAsyncExternalId
  context: AsyncTaskPollContext
}

export interface AsyncTaskProviderRegistration {
  providerCode: AsyncExternalIdProvider
  providerKey: string
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
