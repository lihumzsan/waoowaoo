import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * POST /api/projects/[projectId]/upload-media
 * Register one user-uploaded image or audio file (multipart `file`, optional
 * `name`) as a chat attachment: bytes are sanitized and stored, the shared
 * MediaObject is registered, and a signed attachment receipt is returned.
 * No WorkspaceResource is created; the Agent materializes attachments on
 * demand through the register_uploaded_media operation.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_project_upload_media',
    projectId,
    userId: auth.session.user.id,
    input: {},
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
