import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError, normalizeError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import { normalizeConfirmedOperationRequest } from '@/lib/project-agent/confirmed-operation-request'
import { normalizeOperationRuntimeSignal } from '@/lib/project-agent/runtime-signal'
import { createProjectAgentWait } from '@/lib/project-agent/waits'

export const runtime = 'nodejs'

function readErrorCode(error: ApiError): string {
  const detailCode = typeof error.details?.code === 'string' && error.details.code.trim()
    ? error.details.code.trim()
    : null
  return detailCode || error.code
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
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

  const confirmedRequest = normalizeConfirmedOperationRequest(body)
  try {
    const result = await executeProjectAgentOperationFromApi({
      request,
      projectId,
      userId: authResult.session.user.id,
      operationId: confirmedRequest.operationId,
      input: confirmedRequest.input,
      context: confirmedRequest.context,
      source: 'assistant-confirmation',
    })
    const runtimeSignal = normalizeOperationRuntimeSignal({
      toolName: confirmedRequest.operationId,
      output: {
        ok: true,
        data: result,
      },
    })
    if (runtimeSignal.kind === 'await_task' && runtimeSignal.taskIds.length > 0) {
      const contextRecord = confirmedRequest.context && typeof confirmedRequest.context === 'object' && !Array.isArray(confirmedRequest.context)
        ? confirmedRequest.context as Record<string, unknown>
        : null
      const episodeId = typeof contextRecord?.episodeId === 'string' && contextRecord.episodeId.trim()
        ? contextRecord.episodeId.trim()
        : null
      await createProjectAgentWait({
        projectId,
        userId: authResult.session.user.id,
        episodeId,
        assistantId: 'workspace-command',
        operationId: runtimeSignal.operationId,
        taskIds: runtimeSignal.taskIds,
      })
    }

    return NextResponse.json({
      ok: true,
      operationId: confirmedRequest.operationId,
      data: result,
    })
  } catch (error) {
    const normalized = normalizeError(error)
    return NextResponse.json({
      ok: false,
      operationId: confirmedRequest.operationId,
      error: {
        code: readErrorCode(normalized),
        message: normalized.message,
        operationId: confirmedRequest.operationId,
        details: normalized.details ?? null,
      },
    })
  }
})
