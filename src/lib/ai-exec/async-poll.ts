import {
  resolveAsyncTaskProviderByCode,
  resolveAsyncTaskProviderByExternalId,
} from '@/lib/ai-providers'
import type {
  AsyncExternalIdProvider,
  AsyncExternalIdType,
  AsyncPollResult,
  ParsedAsyncExternalId,
} from '@/lib/ai-providers/async-task-types'
import { getProviderConfig, getUserModels } from '@/lib/user-api/runtime-config'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withRetry } from '@/lib/retry'

export type PollResult = AsyncPollResult
export type ParsedExternalId = ParsedAsyncExternalId
export type FormatExternalIdProvider = AsyncExternalIdProvider
export type FormatExternalIdType = AsyncExternalIdType

export function parseExternalId(externalId: string): ParsedExternalId {
  return resolveAsyncTaskProviderByExternalId(externalId).parseExternalId(externalId)
}

export async function pollAsyncTask(
  externalId: string,
  userId: string,
): Promise<PollResult> {
  if (!userId) {
    throw new Error('缺少用户ID，无法获取 API Key')
  }

  const registration = resolveAsyncTaskProviderByExternalId(externalId)
  const parsed = registration.parseExternalId(externalId)
  return await withRetry({
    operation: EXTERNAL_OPERATION.PROVIDER_POLL,
    scope: `media:poll:${externalId}`,
    run: async () => await registration.poll({
      parsed,
      context: {
        userId,
        getProviderConfig,
        getUserModels,
      },
    }),
  })
}

/**
 * Provider-side cancel dispatch for one external job. Capability is declared by
 * the provider's async-task registration (`cancel`), never guessed by callers;
 * providers without cancel report `unsupported` so best-effort compensation can
 * proceed without inventing a second provider protocol.
 */
export async function cancelAsyncTask(
  externalId: string,
  userId: string,
): Promise<'canceled' | 'unsupported'> {
  if (!userId) {
    throw new Error('缺少用户ID，无法获取 API Key')
  }

  const registration = resolveAsyncTaskProviderByExternalId(externalId)
  if (!registration.cancel) return 'unsupported'
  const parsed = registration.parseExternalId(externalId)
  await withRetry({
    operation: EXTERNAL_OPERATION.PROVIDER_CANCEL,
    scope: `media:cancel:${externalId}`,
    run: async () => await registration.cancel!({
      parsed,
      context: {
        userId,
        getProviderConfig,
        getUserModels,
      },
    }),
  })
  return 'canceled'
}

export function formatExternalId(
  provider: FormatExternalIdProvider,
  type: FormatExternalIdType,
  requestId: string,
  endpoint?: string,
  providerToken?: string,
  modelKeyToken?: string,
): string {
  return resolveAsyncTaskProviderByCode(provider).formatExternalId({
    type,
    requestId,
    endpoint,
    providerToken,
    modelKeyToken,
  })
}
