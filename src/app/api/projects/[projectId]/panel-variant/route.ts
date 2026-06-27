import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const storyboardId = body?.storyboardId
  const insertAfterPanelId = body?.insertAfterPanelId
  const sourcePanelId = body?.sourcePanelId
  const variant = body?.variant

  if (!storyboardId || !insertAfterPanelId || !sourcePanelId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!variant || !variant.video_prompt) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'panel_variant',
    projectId,
    userId: authResult.session.user.id,
    input: {
      storyboardId,
      insertAfterPanelId,
      sourcePanelId,
      variant,
      ...(typeof body?.confirmedMaxCost === 'number' ? { confirmedMaxCost: body.confirmedMaxCost } : {}),
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
