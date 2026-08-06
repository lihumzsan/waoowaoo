import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
  joinPublicBetaWaitlist,
  PublicBetaWaitlistError,
  publicBetaWaitlistIsEnabled,
  publicBetaWaitlistRequestSchema,
} from '@/lib/public-beta/waitlist'
import {
  checkRateLimit,
  getClientIp,
  PUBLIC_BETA_WAITLIST_LIMIT,
} from '@/lib/rate-limit'

export const POST = apiHandler(async (request: NextRequest) => {
  if (!publicBetaWaitlistIsEnabled()) throw new ApiError('NOT_FOUND')

  const rateResult = await checkRateLimit(
    'public-beta:waitlist',
    getClientIp(request),
    PUBLIC_BETA_WAITLIST_LIMIT,
  )
  if (rateResult.limited) {
    throw new ApiError('RATE_LIMIT', {
      retryAfterSeconds: rateResult.retryAfterSeconds,
    })
  }

  const body: unknown = await request.json().catch(() => null)
  const parsed = publicBetaWaitlistRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('PUBLIC_BETA_WAITLIST_INVALID_INPUT')
  }

  try {
    const receipt = await joinPublicBetaWaitlist(parsed.data)
    return NextResponse.json({ success: true, ...receipt })
  } catch (error) {
    if (error instanceof PublicBetaWaitlistError) {
      if (error.code === 'unavailable') {
        throw new ApiError('NOT_FOUND', undefined, { cause: error })
      }
      if (error.code === 'invalid_input') {
        throw new ApiError('PUBLIC_BETA_WAITLIST_INVALID_INPUT', undefined, { cause: error })
      }
      if (error.code === 'not_open') {
        throw new ApiError('PUBLIC_BETA_WAITLIST_NOT_OPEN', undefined, { cause: error })
      }
    }
    throw error
  }
})
