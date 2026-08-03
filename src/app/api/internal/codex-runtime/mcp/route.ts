import {
  handleWaoMcpHttpRequest,
  WaoMcpHttpBindingError,
} from '@/lib/wao-mcp/http-transport'
import {
  verifyWaoRuntimeBearerAuthorization,
  WaoRuntimeTokenError,
} from '@/lib/wao-mcp/runtime-token'
import type { WaoRuntimeTokenPayload } from '@/lib/wao-mcp/runtime-token'
import { hasAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(status: number, code: string): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      error: { code: -32000, message: code },
      id: null,
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

/**
 * Internal capability boundary for runtime containers. This intentionally does
 * not use browser-session apiHandler authentication: the only accepted
 * principal is the short-lived, project-scope HMAC bearer issued by Wao.
 */
async function handleAuthenticatedMcpRequest(
  request: Request,
): Promise<Response> {
  let scope: WaoRuntimeTokenPayload
  try {
    scope = verifyWaoRuntimeBearerAuthorization(
      request.headers.get('authorization'),
    )
  } catch (error) {
    if (error instanceof WaoRuntimeTokenError) {
      return jsonError(401, 'WAO_RUNTIME_AUTHENTICATION_FAILED')
    }
    return jsonError(500, 'WAO_RUNTIME_AUTHENTICATION_UNAVAILABLE')
  }

  if (!await hasAssistantRuntimeOwnership(scope, scope.nonce)) {
    return jsonError(403, 'WAO_RUNTIME_OWNERSHIP_REQUIRED')
  }

  try {
    return await handleWaoMcpHttpRequest({ request, scope })
  } catch (error) {
    if (error instanceof WaoMcpHttpBindingError) {
      return jsonError(403, 'WAO_RUNTIME_ACTIVE_TURN_REQUIRED')
    }
    if (request.signal.aborted) {
      return jsonError(499, 'WAO_RUNTIME_REQUEST_ABORTED')
    }
    return jsonError(500, 'WAO_RUNTIME_MCP_FAILED')
  }
}

export const POST = handleAuthenticatedMcpRequest
export const GET = handleAuthenticatedMcpRequest
export const DELETE = handleAuthenticatedMcpRequest
