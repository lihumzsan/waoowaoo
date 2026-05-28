import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = toObject(await request.json().catch(() => ({})))
  const characterRequest = normalizeString(body.characterRequest)
  if (!characterRequest) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'character_style_test',
    projectId,
    userId: authResult.session.user.id,
    context: {},
    input: {
      characterRequest,
      confirmed: true,
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
