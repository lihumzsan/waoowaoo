import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { retryTextPlacementAsset, retryTextPlacementFinalImage } from '@/lib/text-placement-test/service'
import { textPlacementRetryRequestSchema } from '@/lib/text-placement-test/types'

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

  const parsed = textPlacementRetryRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TEXT_PLACEMENT_TEST_RETRY_INPUT_INVALID',
      issues: parsed.error.issues,
    })
  }

  if (parsed.data.type === 'asset') {
    const asset = await retryTextPlacementAsset({
      userId: authResult.session.user.id,
      request: parsed.data,
    })
    return NextResponse.json({
      success: true,
      type: 'asset',
      asset,
    })
  }

  const image = await retryTextPlacementFinalImage({
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    request: parsed.data,
  })
  return NextResponse.json({
    success: true,
    type: 'finalImage',
    image,
  })
})
