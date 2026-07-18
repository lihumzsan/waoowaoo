import { ApiError } from '@/lib/api-errors'
import type { StoredProvider } from './api-config-types'
import { assertProviderBaseUrlShape } from '@/lib/http/outbound-url-policy'
import { getProviderKey, isRecord, readTrimmedString } from './api-config-shared'

const SUPPORTED_PROVIDER_KEYS = new Set(['ark', 'openrouter', 'fal', 'google'])

function assertSupportedProvider(providerId: string, field: string) {
  if (SUPPORTED_PROVIDER_KEYS.has(getProviderKey(providerId))) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'PROVIDER_NOT_SUPPORTED',
    field,
  })
}

export function resolveProviderByIdOrKey(providers: StoredProvider[], providerId: string): StoredProvider | null {
  const exact = providers.find((provider) => provider.id === providerId)
  if (exact) return exact

  const providerKey = getProviderKey(providerId)
  const candidates = providers.filter((provider) => getProviderKey(provider.id) === providerKey)
  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_AMBIGUOUS',
      field: 'providers',
    })
  }

  return candidates[0]
}

export function normalizeProvidersInput(rawProviders: unknown): StoredProvider[] {
  if (rawProviders === undefined) return []
  if (!Array.isArray(rawProviders)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'providers',
    })
  }

  const normalized: StoredProvider[] = []
  for (let index = 0; index < rawProviders.length; index += 1) {
    const item = rawProviders[index]
    if (!isRecord(item)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `providers[${index}]`,
      })
    }
    const id = readTrimmedString(item.id)
    const name = readTrimmedString(item.name)
    if (!id || !name) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `providers[${index}]`,
      })
    }
    const normalizedId = id.toLowerCase()
    assertSupportedProvider(normalizedId, `providers[${index}].id`)
    if (normalized.some((provider) => provider.id.toLowerCase() === normalizedId)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_DUPLICATE',
        field: `providers[${index}].id`,
      })
    }
    const hiddenRaw = item.hidden
    if (hiddenRaw !== undefined && typeof hiddenRaw !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_HIDDEN_INVALID',
        field: `providers[${index}].hidden`,
      })
    }

    const rawBaseUrl = readTrimmedString(item.baseUrl)
    let baseUrl: string | undefined
    try {
      baseUrl = rawBaseUrl ? assertProviderBaseUrlShape(rawBaseUrl) : undefined
    } catch {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_BASE_URL_UNSAFE',
        field: `providers[${index}].baseUrl`,
      })
    }

    normalized.push({
      id,
      name,
      baseUrl,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey.trim() : undefined,
      hidden: hiddenRaw === true,
    })
  }

  return normalized
}

export function parseStoredProviders(rawProviders: string | null | undefined): StoredProvider[] {
  if (!rawProviders) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }

  const normalized: StoredProvider[] = []
  for (let index = 0; index < parsedUnknown.length; index += 1) {
    const raw = parsedUnknown[index]
    if (!isRecord(raw)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `customProviders[${index}]`,
      })
    }

    const id = readTrimmedString(raw.id)
    const name = readTrimmedString(raw.name)
    if (!id || !name) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_PAYLOAD_INVALID',
        field: `customProviders[${index}]`,
      })
    }

    assertSupportedProvider(id, `customProviders[${index}].id`)

    const hiddenRaw = raw.hidden
    if (hiddenRaw !== undefined && typeof hiddenRaw !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROVIDER_HIDDEN_INVALID',
        field: `customProviders[${index}].hidden`,
      })
    }

    const baseUrl = readTrimmedString(raw.baseUrl) || undefined

    normalized.push({
      id,
      name,
      baseUrl,
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : undefined,
      hidden: hiddenRaw === true,
    })
  }

  return normalized
}
