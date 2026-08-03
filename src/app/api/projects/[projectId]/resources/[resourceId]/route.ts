import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { readWorkspaceResource } from '@/lib/workspace-resource/view-service'

/**
 * Single-resource read: the only place the UI may load a resource's full
 * content (WR-13 keeps tree/search bounded to summaries).
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; resourceId: string }> },
) => {
  const { projectId, resourceId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth
  const resource = await readWorkspaceResource({
    projectId,
    userId: auth.session.user.id,
    resourceId,
  })
  return NextResponse.json({ success: true, resource })
})
