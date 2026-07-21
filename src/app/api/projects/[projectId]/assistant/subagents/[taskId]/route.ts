import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { readProjectAgentSubagentDetail } from '@/lib/project-agent/subagent-detail'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; taskId: string }> },
) => {
  const { projectId, taskId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const detail = await readProjectAgentSubagentDetail({
    projectId,
    taskId,
    userId: authResult.session.user.id,
  })
  return NextResponse.json({ success: true, detail })
})
