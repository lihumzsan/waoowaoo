import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import {
  handleTencentSmsDeliveryReports,
  parseTencentSmsDeliveryReports,
  type TencentSmsDeliveryReport,
} from '@/lib/auth/tencent-sms-delivery'
import { requirePhoneAuthEnabled } from '@/lib/auth/phone-verification'
import { readJsonWithLimit } from '@/lib/http/body-limits'
import { createScopedLogger } from '@/lib/logging/core'

export const runtime = 'nodejs'

const CALLBACK_BODY_LIMIT_BYTES = 128 * 1024
const logger = createScopedLogger({
  module: 'auth.tencent_sms_callback',
  provider: 'tencent-sms',
})

function callbackResponse(result: number, errmsg: string, status: number): NextResponse {
  return NextResponse.json({ result, errmsg }, { status })
}

export const POST = apiHandler(async (request: NextRequest) => {
  try {
    requirePhoneAuthEnabled()
  } catch {
    return callbackResponse(1, 'NOT_AVAILABLE', 404)
  }

  let reports: TencentSmsDeliveryReport[]
  try {
    const payload = await readJsonWithLimit(
      request,
      CALLBACK_BODY_LIMIT_BYTES,
      'Tencent SMS delivery callback',
    )
    reports = parseTencentSmsDeliveryReports(payload)
  } catch (error) {
    logger.warn({
      action: 'sms.callback.rejected',
      message: 'Tencent SMS delivery callback payload was rejected',
      retryable: false,
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: 'UnknownError', message: 'Unknown callback payload error' },
    })
    return callbackResponse(1, 'INVALID_REQUEST', 400)
  }

  try {
    const result = await handleTencentSmsDeliveryReports(reports)
    logger.info({
      action: 'sms.callback.handled',
      message: 'Tencent SMS delivery callback handled',
      details: result,
    })
    return callbackResponse(0, 'OK', 200)
  } catch (error) {
    logger.error({
      action: 'alert.sms.callback.retryable_failure',
      message: 'Tencent SMS delivery callback processing failed',
      retryable: true,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { name: 'UnknownError', message: 'Unknown callback processing error' },
    })
    return callbackResponse(1, 'RETRY', 500)
  }
})
