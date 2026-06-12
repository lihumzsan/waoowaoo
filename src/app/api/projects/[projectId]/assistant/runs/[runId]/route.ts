import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { getPendingProjectAgentApprovalInterruption } from '@/lib/project-agent/interruptions'
import { getProjectAgentRun } from '@/lib/project-agent/runs'

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; runId: string }> },
) => {
  const { projectId, runId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const episodeId = request.nextUrl.searchParams.get('episodeId')?.trim() || null

  const run = await getProjectAgentRun({
    projectId,
    userId: authResult.session.user.id,
    episodeId,
    assistantId: 'workspace-command',
    runId,
  })
  if (!run) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'PROJECT_AGENT_RUN_NOT_FOUND',
        message: 'Project agent run not found',
      },
    }, { status: 404 })
  }
  const pendingApproval = await getPendingProjectAgentApprovalInterruption({
    projectId,
    userId: authResult.session.user.id,
    episodeId,
    assistantId: 'workspace-command',
    runId,
  })

  return NextResponse.json({
    success: true,
    run: {
      id: run.id,
      projectId: run.projectId,
      episodeId: run.episodeId,
      assistantId: run.assistantId,
      status: run.status,
      controlKind: run.controlKind,
      requestId: run.requestId,
    },
    pendingApproval: pendingApproval
      ? {
          interruptionId: pendingApproval.id,
          approvalId: pendingApproval.approvalId,
          operationId: pendingApproval.operationId,
          toolCallId: pendingApproval.toolCallId,
        }
      : null,
  })
})
