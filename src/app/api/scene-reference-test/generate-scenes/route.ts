import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { submitSceneReferenceTestTask } from '@/lib/scene-reference-test/submit'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const body = toObject(await request.json().catch(() => ({})))
  const result = await submitSceneReferenceTestTask({
    request,
    userId: authResult.session.user.id,
    body,
  })

  return NextResponse.json(result)
})
