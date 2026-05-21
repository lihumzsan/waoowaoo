import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { coordinatePlacementTestRequestSchema } from '@/lib/coordinate-placement-test/types'
import { runCoordinatePlacementTest } from '@/lib/coordinate-placement-test/service'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }

  const parsed = coordinatePlacementTestRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'COORDINATE_PLACEMENT_TEST_INPUT_INVALID',
      issues: parsed.error.issues,
    })
  }

  const result = await runCoordinatePlacementTest({
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    request: parsed.data,
  })

  return NextResponse.json(result)
})
