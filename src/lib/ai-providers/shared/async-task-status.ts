import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { createFailureRecord, type FailureDetails, type FailureRecord } from '@/lib/errors/failure'
import type { UnifiedErrorCode } from '@/lib/errors/codes'

type ProviderAsyncTaskStatusFields = {
  imageUrl?: string
  videoUrl?: string
  actualVideoTokens?: number
}

export type ProviderAsyncTaskStatus = ProviderAsyncTaskStatusFields & (
  | {
    status: 'pending' | 'completed'
    failure?: never
  }
  | {
    status: 'failed'
    failure: FailureRecord
  }
)

export function createProviderAsyncTaskFailure(input: {
  readonly provider: string
  readonly code: UnifiedErrorCode
  readonly message: string
  readonly cause: unknown
  readonly details?: FailureDetails
}): FailureRecord {
  return createFailureRecord(input.code, input.message, {
    cause: input.cause,
    details: input.details,
    context: { system: 'provider', provider: input.provider, phase: 'poll' },
    operation: EXTERNAL_OPERATION.PROVIDER_TERMINAL_RESULT,
  })
}
