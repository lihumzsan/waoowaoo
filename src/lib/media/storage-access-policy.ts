import { ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse, type AuthSession } from '@/lib/api-auth'

function assertStorageKeySafe(key: string): void {
  if (!key.trim() || key.startsWith('/') || key.includes('..')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORAGE_KEY_INVALID',
      field: 'key',
    })
  }
}

export async function authorizeStorageObjectRead(key: string): Promise<AuthSession | Response> {
  assertStorageKeySafe(key)
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  return authResult.session
}
