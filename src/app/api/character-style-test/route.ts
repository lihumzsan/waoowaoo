import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { submitCharacterStyleTestTask } from '@/lib/character-style-test/submit'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = toObject(await request.json().catch(() => ({})))
  const characterRequest = normalizeString(body.characterRequest)
  if (!characterRequest) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await submitCharacterStyleTestTask({
    request,
    userId: authResult.session.user.id,
    characterRequest,
  })

  return NextResponse.json(result)
})
