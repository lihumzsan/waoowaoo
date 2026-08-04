import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

const requestSchema = z.object({
  resourceId: z.string().min(1).max(64),
}).strict()

/**
 * POST /api/projects/[projectId]/assistant/resource-attachments
 * Issue a signed chat-attachment receipt for an existing project image
 * Resource, so a canvas selection can enter the assistant message exactly
 * like an uploaded attachment. Read-only; the single token authority signs.
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const auth = await requireProjectAuthLight(projectId)
  if (isErrorResponse(auth)) return auth

  const body: unknown = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOURCE_ATTACHMENT_INPUT_INVALID', field: 'resourceId' })
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'api_project_resource_attachment',
    projectId,
    userId: auth.session.user.id,
    input: parsed.data,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
