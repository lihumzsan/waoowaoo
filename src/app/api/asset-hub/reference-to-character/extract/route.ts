import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const input: unknown = await request.json()
  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'asset_hub_extract_reference_character_description',
    projectId: 'global-asset-hub',
    userId: authResult.session.user.id,
    input,
    source: 'asset-hub',
  })
  return NextResponse.json(result)
})
