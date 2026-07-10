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
  const panelId = body?.panelId

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (body?.referenceMode !== undefined && body.referenceMode !== 'storyboard' && body.referenceMode !== 'asset') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'IMAGE_REFERENCE_MODE_INVALID',
      field: 'referenceMode',
    })
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'regenerate_panel_image',
    projectId,
    userId: authResult.session.user.id,
    input: {
      panelId,
      ...(body?.count !== undefined ? { count: body.count } : {}),
      ...(body?.referenceMode === 'storyboard' || body?.referenceMode === 'asset' ? { referenceMode: body.referenceMode } : {}),
      ...(Array.isArray(body?.referencePanelIds) ? { referencePanelIds: body.referencePanelIds } : {}),
      ...(Array.isArray(body?.extraImageUrls) ? { extraImageUrls: body.extraImageUrls } : {}),
      ...(Array.isArray(body?.referenceImageNotes) ? { referenceImageNotes: body.referenceImageNotes } : {}),
      ...(typeof body?.approvalGrantId === 'string' ? { approvalGrantId: body.approvalGrantId } : {}),
      ...(typeof body?.operationRequestId === 'string' ? { operationRequestId: body.operationRequestId } : {}),
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
