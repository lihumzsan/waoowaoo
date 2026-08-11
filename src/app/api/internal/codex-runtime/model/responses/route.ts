import {
  CodexModelGatewayError,
  proxyCodexResponsesRequest,
} from '@/lib/codex-model-gateway'
import {
  verifyWaoRuntimeBearerAuthorization,
  WaoRuntimeTokenError,
} from '@/lib/wao-mcp/runtime-token'
import type { WaoRuntimeTokenPayload } from '@/lib/wao-mcp/runtime-token'
import { createScopedLogger } from '@/lib/logging/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const logger = createScopedLogger({ module: 'codex-gateway.model' })

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function errorResponse(status: number, code: string): Response {
  return Response.json(
    {
      error: {
        type: 'invalid_request_error',
        code,
        message: code,
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(status === 401
          ? { 'WWW-Authenticate': 'Bearer realm="wao-codex-runtime"' }
          : {}),
      },
    },
  )
}

/** Internal Responses API capability boundary; browser sessions are invalid. */
export async function POST(request: Request): Promise<Response> {
  let scope: WaoRuntimeTokenPayload
  try {
    scope = verifyWaoRuntimeBearerAuthorization(
      request.headers.get('authorization'),
    )
  } catch (error) {
    if (error instanceof WaoRuntimeTokenError) {
      return errorResponse(401, 'WAO_RUNTIME_AUTHENTICATION_FAILED')
    }
    return errorResponse(500, 'WAO_RUNTIME_AUTHENTICATION_UNAVAILABLE')
  }

  try {
    return await proxyCodexResponsesRequest({ request, scope })
  } catch (error) {
    if (error instanceof CodexModelGatewayError) {
      logger.warn({
        action: 'codex_gateway.request_rejected',
        message: 'Codex model request was rejected before Provider submission',
        projectId: scope.projectId,
        userId: scope.userId,
        details: {
          code: error.code,
          httpStatus: error.httpStatus,
          causeCode: readErrorCode(error.cause),
          causeName: error.cause instanceof Error ? error.cause.name : null,
        },
      })
      if (error.code === 'BILLING_BALANCE_INSUFFICIENT') {
        return errorResponse(429, 'usage_not_included')
      }
      if (
        error.code === 'ASSISTANT_MODEL_NOT_CONFIGURED'
        || error.code === 'ASSISTANT_MODEL_UNSUPPORTED'
        || error.code === 'PROVIDER_RESPONSES_UNSUPPORTED'
        || error.code === 'PROVIDER_CONFIG_UNAVAILABLE'
        || error.code === 'PROVIDER_BASE_URL_INVALID'
        || error.code === 'PROVIDER_REQUEST_FAILED'
      ) {
        return errorResponse(503, 'slow_down')
      }
      return errorResponse(error.httpStatus, error.code)
    }
    if (request.signal.aborted) {
      return errorResponse(499, 'REQUEST_ABORTED')
    }
    logger.error({
      action: 'codex_gateway.request_failed',
      message: 'Codex model gateway failed before Provider submission',
      projectId: scope.projectId,
      userId: scope.userId,
      error,
    })
    return errorResponse(500, 'CODEX_MODEL_GATEWAY_FAILED')
  }
}
