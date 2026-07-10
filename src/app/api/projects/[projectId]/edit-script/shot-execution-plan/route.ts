import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { readProjectEditShotExecutionPlan } from '@/lib/edit-script/service'
import { submitProjectEditShotExecutionPlanTask } from '@/lib/edit-script/task-submission'
import {
  createEditShotExecutionPlanRequestSchema,
  getEditShotExecutionPlanRequestSchema,
} from '@/lib/edit-script/types'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const parsed = getEditShotExecutionPlanRequestSchema.safeParse({
    episodeId: searchParams.get('episodeId'),
    chapterId: searchParams.get('chapterId') ?? undefined,
  })
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const shotExecutionPlan = await readProjectEditShotExecutionPlan({
    projectId,
    episodeId: parsed.data.episodeId,
    chapterId: parsed.data.chapterId,
  })
  return NextResponse.json({ shotExecutionPlan })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = createEditShotExecutionPlanRequestSchema.safeParse(body)
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const result = await submitProjectEditShotExecutionPlanTask({
    request,
    projectId,
    episodeId: parsed.data.episodeId,
    chapterId: parsed.data.chapterId,
    userId: authResult.session.user.id,
    source: 'project-ui',
    locale: resolveRequiredTaskLocale(request, body),
    ...(parsed.data.editScriptId ? { editScriptId: parsed.data.editScriptId } : {}),
  })

  return NextResponse.json(result)
})
