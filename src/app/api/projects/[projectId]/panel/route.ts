import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

/**
 * PATCH /api/projects/[projectId]/panel
 * 更新单个 Panel 的属性（视频提示词等）
 * 支持两种更新方式：
 * 1. 通过 panelId 直接更新（推荐，用于清除错误等操作）
 * 2. 通过 storyboardId + panelIndex 更新
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const { panelId, storyboardId, panelIndex, videoPrompt, imagePrompt, actingNotes } = body

  // 方式1：通过 panelId 直接更新（优先）
  if (panelId) {
    await executeProjectAgentOperationFromApi({
      request,
      operationId: 'update_storyboard_panel_prompt',
      projectId,
      userId: authResult.session.user.id,
      input: {
        panelId,
        ...(imagePrompt !== undefined ? { imagePrompt } : {}),
        ...(videoPrompt !== undefined ? { videoPrompt } : {}),
        ...(actingNotes !== undefined ? { actingNotes } : {}),
      },
      source: 'project-ui',
    })

    return NextResponse.json({ success: true })
  }

  // 方式2：通过 storyboardId + panelIndex 更新
  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  await executeProjectAgentOperationFromApi({
    request,
    operationId: 'update_storyboard_panel_prompt',
    projectId,
    userId: authResult.session.user.id,
    input: {
      storyboardId,
      panelIndex: Number(panelIndex),
      ...(imagePrompt !== undefined ? { imagePrompt } : {}),
      ...(videoPrompt !== undefined ? { videoPrompt } : {}),
      ...(actingNotes !== undefined ? { actingNotes } : {}),
    },
    source: 'project-ui',
  })

  return NextResponse.json({ success: true })
})
