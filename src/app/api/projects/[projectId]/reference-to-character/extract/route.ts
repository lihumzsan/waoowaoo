import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const input: unknown = await request.json()
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'extract_reference_character_description',
    projectId,
    userId: authResult.session.user.id,
    input,
    source: 'project-ui',
  })
  return NextResponse.json(result)
})
