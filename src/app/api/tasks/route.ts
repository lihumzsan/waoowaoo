import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const searchParams = request.nextUrl.searchParams
  const limit = searchParams.get('limit')
  const statuses = searchParams.getAll('status')
  const types = searchParams.getAll('type')
  const input = {
    projectId: searchParams.get('projectId') || undefined,
    targetType: searchParams.get('targetType') || undefined,
    targetId: searchParams.get('targetId') || undefined,
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(types.length > 0 ? { type: types } : {}),
    ...(limit !== null ? { limit: Number(limit) } : {}),
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'list_tasks',
    projectId: 'system',
    userId: session.user.id,
    input,
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
