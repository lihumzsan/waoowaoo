import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { runTextPlacementTest } from '@/lib/text-placement-test/service'
import { textPlacementTestRunRequestSchema, type TextPlacementTestProgressEvent } from '@/lib/text-placement-test/types'

type TextPlacementTestStreamEvent =
  | TextPlacementTestProgressEvent
  | {
      readonly type: 'error'
      readonly message: string
    }

function formatTextPlacementEvent(event: TextPlacementTestStreamEvent): string {
  return `event: text-placement-test\ndata: ${JSON.stringify(event)}\n\n`
}

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

  const parsed = textPlacementTestRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TEXT_PLACEMENT_TEST_INPUT_INVALID',
      issues: parsed.error.issues,
    })
  }

  const userId = authResult.session.user.id
  const locale = resolveRequiredTaskLocale(request, body)
  const encoder = new TextEncoder()
  let closeStream: (() => void) | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {}
      }
      closeStream = close
      const send = (event: TextPlacementTestStreamEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(formatTextPlacementEvent(event)))
      }

      request.signal.addEventListener('abort', close)

      void runTextPlacementTest({
        userId,
        locale,
        request: parsed.data,
        onProgress: send,
      }).then(() => {
        close()
      }).catch((caught: unknown) => {
        send({
          type: 'error',
          message: caught instanceof Error ? caught.message : String(caught),
        })
        close()
      })
    },
    cancel() {
      closeStream?.()
    },
  })

  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
