import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { readWorkspaceResourceByPath } from '@/lib/workspace-resource/view-service'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const workspacePath = request.nextUrl.searchParams.get('path')
  if (!workspacePath) throw new ApiError('INVALID_PARAMS', { field: 'path' })
  const resource = await readWorkspaceResourceByPath({
    projectId,
    userId: auth.session.user.id,
    workspacePath,
  })
  return NextResponse.json({ success: true, resource })
})
