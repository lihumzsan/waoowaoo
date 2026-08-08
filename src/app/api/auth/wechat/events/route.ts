import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-errors'
import {
  readWechatOfficialAttemptView,
  wechatOfficialAttemptChannel,
} from '@/lib/auth/wechat-official-attempt'
import {
  WECHAT_OFFICIAL_RESULT_CODES,
  WechatOfficialError,
} from '@/lib/auth/wechat-official-config'
import { getSharedSubscriber } from '@/lib/sse/shared-subscriber'
import {
  AUTH_WECHAT_STREAM_LIMIT,
  checkRateLimit,
  getClientIp,
} from '@/lib/rate-limit'

const requestSchema = z.object({
  attemptId: z.string().min(1),
  browserToken: z.string().min(1),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const rateResult = await checkRateLimit(
    'auth:wechat-official:events',
    getClientIp(request),
    AUTH_WECHAT_STREAM_LIMIT,
  )
  if (rateResult.limited) {
    return NextResponse.json(
      { success: false, code: 'WECHAT_OFFICIAL_RATE_LIMITED' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateResult.retryAfterSeconds) },
      },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, code: WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid },
      { status: 400 },
    )
  }

  try {
    await readWechatOfficialAttemptView(parsed.data)
  } catch (error) {
    if (error instanceof WechatOfficialError) {
      return NextResponse.json(
        { success: false, code: error.code },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    throw error
  }

  const encoder = new TextEncoder()
  const signal = request.signal
  const subscriber = getSharedSubscriber()
  let closeStream: (() => Promise<void>) | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let removeListener: (() => Promise<void>) | null = null
      let transitionInFlight = false
      let heartbeat: ReturnType<typeof setInterval> | null = null

      const cleanup = async () => {
        const remove = removeListener
        removeListener = null
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
        signal.removeEventListener('abort', abortHandler)
        await remove?.()
      }

      const close = async () => {
        if (closed) return
        closed = true
        await cleanup()
        try {
          controller.close()
        } catch {}
      }
      closeStream = close

      const projectCurrentState = async () => {
        if (closed || transitionInFlight) return
        transitionInFlight = true
        try {
          const view = await readWechatOfficialAttemptView(parsed.data)
          if (closed) return
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(view)}\n\n`))
          if (view.state !== 'pending') await close()
        } catch (error) {
          if (!closed) {
            closed = true
            await cleanup()
            controller.error(error)
          }
        } finally {
          transitionInFlight = false
        }
      }

      const abortHandler = () => {
        void close()
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      removeListener = await subscriber.addChannelListener(
        wechatOfficialAttemptChannel(parsed.data.attemptId),
        () => { void projectCurrentState() },
      )
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': keep-alive\n\n'))
      }, 15_000)
      controller.enqueue(encoder.encode(': connected\n\n'))
      await projectCurrentState()
    },
    async cancel() {
      await closeStream?.()
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})
