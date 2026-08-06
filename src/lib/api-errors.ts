import { createScopedLogger } from '@/lib/logging/core'
import { withLogContext } from '@/lib/logging/context'
import { NextRequest, NextResponse } from 'next/server'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { projectErrorForUser, projectPublicErrorDetails } from '@/lib/errors/projection'
import {
  createFailureRecord,
  type FailureRecord,
} from '@/lib/errors/failure'

type RouteParamValue = string | string[] | undefined
type RouteParams = Record<string, RouteParamValue>

type ApiHandler<TParams extends RouteParams = RouteParams> = (
  req: NextRequest,
  ctx: { params: Promise<TParams> }
) => Promise<Response | NextResponse>

const REQUEST_ID_SYMBOL = Symbol.for('waoowaoo.request_id')
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const GENERATION_OPERATION_PATTERNS = [
  /\/generate(?:-|\/|$)/,
  /\/regenerate(?:-|\/|$)/,
  /\/analyze(?:-|\/|$)/,
  /\/bible-conversion(?:\/|$)/,
  /\/ai-(?:create|modify)-/,
  // 统一 Operation 链路：所有经由 operations registry 的用户执行都属于用户操作审计。
  /\/operations\/[^/]+\/(?:execute|commit)(?:\/|$)/,
]

function isGenerationOperationPath(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase()
  return GENERATION_OPERATION_PATTERNS.some((pattern) => pattern.test(normalizedPath))
}

function shouldAuditUserOperation(method: string, status: number, pathname: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase()) || status >= 500) {
    return false
  }
  return isGenerationOperationPath(pathname)
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}


function setRequestId(req: NextRequest, requestId: string) {
  ;(req as NextRequest & { [REQUEST_ID_SYMBOL]?: string })[REQUEST_ID_SYMBOL] = requestId
}

export function getRequestId(req: NextRequest): string | undefined {
  const fromSymbol = (req as NextRequest & { [REQUEST_ID_SYMBOL]?: string })[REQUEST_ID_SYMBOL]
  if (typeof fromSymbol === 'string' && fromSymbol) return fromSymbol
  const fromHeader = req.headers.get('x-request-id')
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader
  return undefined
}

export function getIdempotencyKey(req: NextRequest): string | undefined {
  const key =
    req.headers.get('idempotency-key')
    || req.headers.get('x-idempotency-key')
  if (typeof key !== 'string') return undefined
  const trimmed = key.trim()
  return trimmed || undefined
}

async function extractRouteContext<TParams extends RouteParams>(
  req: NextRequest,
  ctx: { params: Promise<TParams> },
) {
  let params: Record<string, unknown> = {}
  try {
    params = (await ctx.params) || {}
  } catch {}

  const projectId =
    (typeof params.projectId === 'string' && params.projectId) ||
    req.nextUrl.searchParams.get('projectId') ||
    undefined
  const taskId =
    (typeof params.taskId === 'string' && params.taskId) ||
    req.nextUrl.searchParams.get('taskId') ||
    undefined

  return { projectId, taskId }
}

export type ApiErrorCode = UnifiedErrorCode

export class ApiError extends Error {
  readonly failure: FailureRecord
  code: ApiErrorCode
  status: number
  details?: Record<string, unknown>
  retryable: boolean
  category: string
  userMessageKey: string

  constructor(
    code: ApiErrorCode,
    details?: Record<string, unknown>,
    options?: { readonly cause?: unknown },
  ) {
    const spec = getErrorSpec(code)
    const message =
      typeof details?.message === 'string' && details.message.trim()
        ? details.message.trim()
        : spec.defaultMessage

    super(message)
    this.name = 'ApiError'
    this.failure = createFailureRecord(code, message, {
      cause: options?.cause ?? { name: 'ApiError', message, code },
      details: details ?? null,
      context: { system: 'application', phase: 'api' },
    })
    this.code = code
    this.status = spec.httpStatus
    this.details = details
    this.retryable = spec.retryable
    this.category = spec.category
    this.userMessageKey = spec.userMessageKey
  }

  static fromFailure(failure: FailureRecord, cause?: unknown): ApiError {
    const error = new ApiError(
      failure.interpretation.code,
      failure.interpretation.details ?? undefined,
      { cause },
    )
    Object.defineProperty(error, 'failure', {
      configurable: true,
      enumerable: true,
      value: failure,
      writable: false,
    })
    error.message = failure.native.message
    return error
  }
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error
  }

  const normalized = normalizeAnyError(error)
  return ApiError.fromFailure(normalized, error)
}

export function apiHandler<TParams extends RouteParams>(handler: ApiHandler<TParams>): ApiHandler<TParams> {
  return async (req, ctx) => {
    const startedAt = Date.now()
    const requestId = getRequestId(req) || createRequestId()
    setRequestId(req, requestId)
    const routeContext = await extractRouteContext(req, ctx)
    const logger = createScopedLogger({
      module: 'api',
      requestId,
      projectId: routeContext.projectId,
      taskId: routeContext.taskId,
    })

    return await withLogContext(
      {
        requestId,
        projectId: routeContext.projectId,
        taskId: routeContext.taskId,
        module: 'api',
        action: `${req.method} ${req.nextUrl.pathname}`,
      },
      async () => {
        logger.debug({
          action: 'api.request.start',
          message: 'api request start',
          details: {
            method: req.method,
            path: req.nextUrl.pathname,
          },
        })
        try {
          const response = await handler(req, ctx)
          response.headers.set('x-request-id', requestId)

          // 正常返回的 4xx/5xx（未抛异常）必须在生产可见；成功响应保持 DEBUG。
          const finishEvent = {
            action: 'api.request.finish',
            message: 'api request finished',
            durationMs: Date.now() - startedAt,
            details: {
              method: req.method,
              path: req.nextUrl.pathname,
              status: response.status,
            },
          }
          if (response.status >= 400) {
            logger.warn(finishEvent)
          } else {
            logger.debug(finishEvent)
          }
          if (shouldAuditUserOperation(req.method, response.status, req.nextUrl.pathname)) {
            logger.event({
              level: 'INFO',
              audit: true,
              module: 'user.operation',
              action: 'user.operation',
              message: 'user operation completed',
              durationMs: Date.now() - startedAt,
              details: {
                method: req.method,
                path: req.nextUrl.pathname,
                status: response.status,
              },
            })
          }

          return response
        } catch (error: unknown) {
          const apiError = normalizeError(error)
          const errorType = error instanceof Error ? error.constructor.name : typeof error
          logger.error({
            action: 'api.request.error',
            message: apiError.message,
            errorCode: apiError.code,
            retryable: apiError.retryable,
            durationMs: Date.now() - startedAt,
            details: {
              method: req.method,
              path: req.nextUrl.pathname,
              errorType,
            },
            error:
              error instanceof Error
                ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    code: typeof (error as Error & { code?: unknown }).code === 'string'
                      ? ((error as Error & { code?: string }).code as string)
                      : undefined,
                  }
                : undefined,
          })

          const publicDetails = projectPublicErrorDetails(apiError.details)
          const userProjection = projectErrorForUser(apiError.code, requestId)
          const responseMessage = getErrorSpec(apiError.code).defaultMessage

          const response = NextResponse.json(
            {
              success: false,
              requestId,
              error: {
                code: apiError.code,
                message: responseMessage,
                retryable: apiError.retryable,
                category: apiError.category,
                userMessageKey: apiError.userMessageKey,
                action: userProjection.action,
                details: {
                  ...publicDetails,
                  requestId,
                },
              },
            },
            { status: apiError.status }
          )
          response.headers.set('x-request-id', requestId)
          return response
        }
      },
    )
  }
}

export function throwApiError(code: ApiErrorCode, details?: Record<string, unknown>): never {
  throw new ApiError(code, details)
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
