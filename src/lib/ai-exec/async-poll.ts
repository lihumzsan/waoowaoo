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
  return await registration.poll({
    parsed,
    context: {
      userId,
      getProviderConfig,
      getUserModels,
    },
  })
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
