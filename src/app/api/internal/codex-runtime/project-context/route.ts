import {
  ProjectProductionContextError,
  readProjectProductionContext,
} from '@/lib/project-production-context'
import {
  verifyWaoRuntimeBearerAuthorization,
  WaoRuntimeTokenError,
} from '@/lib/wao-mcp/runtime-token'
import type { WaoRuntimeTokenPayload } from '@/lib/wao-mcp/runtime-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(status: number, code: string): Response {
  return Response.json(
    { error: { code } },
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

/** System-only live context for Codex lifecycle hooks; browser sessions are invalid. */
export async function GET(request: Request): Promise<Response> {
  let scope: WaoRuntimeTokenPayload
  try {
    scope = verifyWaoRuntimeBearerAuthorization(request.headers.get('authorization'))
  } catch (error) {
    if (error instanceof WaoRuntimeTokenError) {
      return errorResponse(401, 'WAO_RUNTIME_AUTHENTICATION_FAILED')
    }
    return errorResponse(500, 'WAO_RUNTIME_AUTHENTICATION_UNAVAILABLE')
  }
  if (scope.assistantId !== 'workspace-command') {
    return errorResponse(403, 'WAO_RUNTIME_ASSISTANT_SCOPE_INVALID')
  }
  try {
    const context = await readProjectProductionContext({
      userId: scope.userId,
      projectId: scope.projectId,
    })
    return Response.json(context, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    if (error instanceof ProjectProductionContextError) {
      return errorResponse(404, 'PROJECT_PRODUCTION_CONTEXT_NOT_FOUND')
    }
    return errorResponse(500, 'PROJECT_PRODUCTION_CONTEXT_UNAVAILABLE')
  }
}
