import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
import {
  isErrorResponse,
  requireProjectAuthLight,
  requireUserAuth,
} from '@/lib/api-auth'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

type TaskTargetQuery = {
  targetType: string
  targetId: string
  types?: string[]
}

function normalizeTarget(input: unknown): TaskTargetQuery {
  const payload = input as Record<string, unknown>
  const targetType = typeof payload.targetType === 'string' ? payload.targetType.trim() : ''
  const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : ''
  const types = Array.isArray(payload.types)
    ? payload.types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined

  if (!targetType || !targetId) {
    throw new ApiError('INVALID_PARAMS')
  }

  return {
    targetType,
    targetId,
    ...(types && types.length > 0 ? { types } : {}),
  }
}

export const POST = apiHandler(async (request: NextRequest) => {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }

  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
  const targetsRaw = Array.isArray(body?.targets) ? body.targets : null

  if (!projectId || !targetsRaw) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (targetsRaw.length > 500) {
    throw new ApiError('INVALID_PARAMS')
  }

  const targets = targetsRaw.map(normalizeTarget)

  if (targets.length === 0) {
    return NextResponse.json({ states: [] })
  }

  let userId: string
  if (projectId === GLOBAL_ASSET_PROJECT_ID) {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    userId = authResult.session.user.id
  } else {
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    userId = authResult.session.user.id
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'get_task_status',
    projectId,
    userId,
    input: { targets },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
