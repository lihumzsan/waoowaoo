import {
  CodexModelGatewayError,
  proxyCodexStandaloneSearchRequest,
} from '@/lib/codex-model-gateway'
import {
  verifyWaoRuntimeBearerAuthorization,
  WaoRuntimeTokenError,
} from '@/lib/wao-mcp/runtime-token'
import type { WaoRuntimeTokenPayload } from '@/lib/wao-mcp/runtime-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(status: number, code: string): Response {
  return Response.json(
    { error: { type: 'invalid_request_error', code, message: code } },
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

/** Internal Codex standalone-search boundary; browser sessions are invalid. */
export async function POST(request: Request): Promise<Response> {
  let scope: WaoRuntimeTokenPayload
  try {
    scope = verifyWaoRuntimeBearerAuthorization(request.headers.get('authorization'))
  } catch (error) {
    if (error instanceof WaoRuntimeTokenError) {
      return errorResponse(401, 'WAO_RUNTIME_AUTHENTICATION_FAILED')
    }
    return errorResponse(500, 'WAO_RUNTIME_AUTHENTICATION_UNAVAILABLE')
  }
  try {
    return await proxyCodexStandaloneSearchRequest({ request, scope })
  } catch (error) {
    if (error instanceof CodexModelGatewayError) {
      if (error.code === 'BILLING_BALANCE_INSUFFICIENT') {
        return errorResponse(429, 'usage_not_included')
      }
      return errorResponse(error.httpStatus, error.code)
    }
    if (request.signal.aborted) return errorResponse(499, 'REQUEST_ABORTED')
    return errorResponse(500, 'CODEX_MODEL_GATEWAY_FAILED')
  }
}
