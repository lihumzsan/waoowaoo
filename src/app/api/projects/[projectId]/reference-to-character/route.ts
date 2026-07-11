import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * 项目级 - 参考图转角色（任务化）
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body: unknown = await request.json()

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'reference_to_character',
    projectId,
    userId: session.user.id,
    input: body,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
