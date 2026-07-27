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

export type AsyncPollResult = AsyncPollResultFields & (
  | {
    status: 'pending' | 'completed'
    failureDisposition?: never
  }
  | {
    status: 'failed'
    failureDisposition: 'retryable' | 'permanent'
  }
)

export function normalizeAsyncPollResult(input: AsyncPollResultFields & {
  readonly status: 'pending' | 'completed' | 'failed'
  readonly failureDisposition?: 'retryable' | 'permanent'
}): AsyncPollResult {
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
}
