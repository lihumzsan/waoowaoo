import { describeUnknownError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { isErrorResponse, requireProjectAuthLight, requireUserAuth } from '@/lib/api-auth'
import {
  isAgentScopedSseEvent,
  type SSEEvent,
} from '@/lib/sse/events'
import { getProjectChannel } from '@/lib/task/publisher'
import {
  advanceWorkspaceSseCursor,
  parseWorkspaceSseBootstrap,
  parseWorkspaceSseCursor,
  parseWorkspaceSseEventMessage,
  serializeWorkspaceSseCursor,
  WORKSPACE_SSE_CONTROL_EVENT_TYPE,
  WORKSPACE_SSE_HEARTBEAT_INTERVAL_MS,
} from '@/lib/sse/protocol'
import {
  WorkspaceSseServerSession,
} from '@/lib/sse/server-session'
import { getSharedSubscriber } from '@/lib/sse/shared-subscriber'
import {
  acquireWorkspaceSseConnectionLease,
  WORKSPACE_SSE_LEASE_RENEW_INTERVAL_MS,
} from '@/lib/sse/connection-lease'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import { readWorkspaceResourceRevision } from '@/lib/workspace-resource/projection-revision'

function formatSSE(event: SSEEvent, transportCursor: string) {
  const dataLine = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  return `id: ${transportCursor}\n${dataLine}`
}

function formatHeartbeat(workspaceResourceRevision: number | null) {
  return `event: ${WORKSPACE_SSE_CONTROL_EVENT_TYPE.HEARTBEAT}\ndata: ${JSON.stringify({
    ts: new Date().toISOString(),
    workspaceResourceRevision,
  })}\n\n`
}

export const GET = apiHandler(async (request: NextRequest) => {
  const projectId = request.nextUrl.searchParams.get('projectId')
  const connectionId = request.nextUrl.searchParams.get('connectionId')
  if (!projectId || !connectionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = projectId === GLOBAL_ASSET_PROJECT_ID
    ? await requireUserAuth()
    : await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const connectionLease = await acquireWorkspaceSseConnectionLease({
    userId: session.user.id,
    projectId,
    connectionId,
  })
  if (!connectionLease) {
    throw new ApiError('RATE_LIMIT', {
      code: 'SSE_CONNECTION_LIMIT_REACHED',
      retryAfterSeconds: Math.ceil(WORKSPACE_SSE_LEASE_RENEW_INTERVAL_MS / 1000),
    })
  }

  const sharedSubscriber = getSharedSubscriber()
  const requestId = getRequestId(request)
  const encoder = new TextEncoder()
  const signal = request.signal
  const requestCursor = request.headers.get('last-event-id')
    || request.nextUrl.searchParams.get('cursor')
  const initialCursor = parseWorkspaceSseCursor(requestCursor)
  let closeStream: (() => Promise<void>) | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let timer: ReturnType<typeof setInterval> | null = null
      let leaseTimer: ReturnType<typeof setInterval> | null = null
      let unsubscribe: (() => Promise<void>) | null = null
      let cleanupPromise: Promise<void> | null = null
      let heartbeatInFlight = false
      const logger = createScopedLogger({
        module: 'sse',
        action: 'sse.stream',
        requestId: requestId || undefined,
        projectId,
        userId: session.user.id})
      logger.info({
        action: 'sse.connect',
        message: 'sse connection established',
        details: {
          lastEventId: requestCursor || '0'}})

      const safeEnqueue = (chunk: string) => {
        if (closed) return
        controller.enqueue(encoder.encode(chunk))
      }

      let transportCursor = initialCursor
      const serverSession = new WorkspaceSseServerSession((event) => {
        transportCursor = advanceWorkspaceSseCursor(transportCursor, event)
        safeEnqueue(formatSSE(event, serializeWorkspaceSseCursor(transportCursor)))
      })

      const cleanup = async () => {
        if (cleanupPromise) return await cleanupPromise
        cleanupPromise = (async () => {
          serverSession.close()
          if (timer) {
            clearInterval(timer)
            timer = null
          }
          if (leaseTimer) {
            clearInterval(leaseTimer)
            leaseTimer = null
          }
          const removeListener = unsubscribe
          unsubscribe = null
          try {
            await removeListener?.()
          } catch (error) {
            logger.error({
              action: 'sse.unsubscribe.failed',
              message: 'failed to release sse subscriber listener',
              error: error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : { message: describeUnknownError(error) },
            })
          }
          try {
            await connectionLease.release()
          } catch (error) {
            logger.error({
              action: 'sse.connection_lease.release_failed',
              message: 'failed to release sse connection lease',
              error: error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : { message: describeUnknownError(error) },
            })
          }
          signal.removeEventListener('abort', abortHandler)
        })()
        return await cleanupPromise
      }

      const fail = async (error: unknown) => {
        if (closed) return
        closed = true
        logger.error({
          action: 'sse.stream.failed',
          message: 'sse stream failed and will be terminated',
          error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: describeUnknownError(error) },
        })
        await cleanup()
        controller.error(error)
      }

      const close = async () => {
        const shouldCloseController = !closed
        closed = true
        await cleanup()
        if (shouldCloseController) {
          logger.info({
            action: 'sse.disconnect',
            message: 'sse connection closed'})
          try {
            controller.close()
          } catch {}
        }
      }
      closeStream = close

      const sendHeartbeat = async (): Promise<void> => {
        if (closed || heartbeatInFlight) return
        heartbeatInFlight = true
        try {
          const workspaceResourceRevision = projectId === GLOBAL_ASSET_PROJECT_ID
            ? null
            : await readWorkspaceResourceRevision({
                projectId,
                userId: session.user.id,
              })
          if (!closed) safeEnqueue(formatHeartbeat(workspaceResourceRevision))
        } finally {
          heartbeatInFlight = false
        }
      }

      const abortHandler = () => {
        void close()
      }
      signal.addEventListener('abort', abortHandler)
      if (signal.aborted) {
        await close()
        return
      }
      leaseTimer = setInterval(() => {
        void connectionLease.renew().then((renewed) => {
          if (!renewed) {
            // A newer connection with the same stable tab identity owns the
            // lease now. Closing this superseded stream is the normal ARL-16
            // handoff; only renewal infrastructure failures use fail().
            void close()
          }
        }).catch((error: unknown) => {
          void fail(error)
        })
      }, WORKSPACE_SSE_LEASE_RENEW_INTERVAL_MS)

      try {
        const expectedChannel = getProjectChannel(projectId)
        const removeListener = await sharedSubscriber.addChannelListener(expectedChannel, (message) => {
          try {
            const payload = parseWorkspaceSseEventMessage(message)
            if (payload.projectId !== projectId) {
              throw new Error(`SSE_MESSAGE_PROJECT_MISMATCH:${payload.projectId}:${projectId}`)
            }
            if (isAgentScopedSseEvent(payload)) {
              if (payload.userId !== session.user.id) return
              if (payload.assistantId !== 'workspace-command') return
            }
            if (projectId === GLOBAL_ASSET_PROJECT_ID && payload.userId !== session.user.id) {
              logger.error({
                action: 'sse.message.user_mismatch',
                message: 'sse message userId mismatch',
                details: { eventUserId: payload.userId, sessionUserId: session.user.id },
              })
              return
            }
            serverSession.receiveLiveEvent(payload)
          } catch (error) {
            logger.error({
              action: 'sse.message.invalid',
              message: 'invalid sse message',
              details: {
                message,
                error: describeUnknownError(error),
              },
            })
            void fail(error)
          }
        })
        if (closed) {
          await removeListener()
          return
        }
        unsubscribe = removeListener

        const bootstrap = await executeProjectAgentOperationFromApi({
          request,
          operationId: 'get_sse_bootstrap',
          projectId,
          userId: session.user.id,
          input: {
            lastEventId: requestCursor,
            includeRecoverableSnapshot: true,
          },
          source: 'project-ui',
        })

        if (closed) return
        const { channel, events, mode } = parseWorkspaceSseBootstrap(bootstrap)

        if (channel !== expectedChannel) {
          throw new ApiError('EXTERNAL_ERROR', {
            code: 'SSE_BOOTSTRAP_CHANNEL_MISMATCH',
            message: 'get_sse_bootstrap returned a different channel',
          })
        }

        logger.info({
          action: mode.startsWith('replay') ? 'sse.replay' : 'sse.active_snapshot',
          message: 'sse bootstrap sent',
          details: { mode, count: events.length },
        })

        serverSession.completeBootstrap(events)
        if (closed) return
        await sendHeartbeat()
        if (closed) return
        timer = setInterval(() => {
          void sendHeartbeat().catch((error: unknown) => {
            void fail(error)
          })
        }, WORKSPACE_SSE_HEARTBEAT_INTERVAL_MS)
      } catch (error) {
        await fail(error)
      }
    },
    cancel() {
      void closeStream?.()
    }})

  return new NextResponse(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'}})
})
