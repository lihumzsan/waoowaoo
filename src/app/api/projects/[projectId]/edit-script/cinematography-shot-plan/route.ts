import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  generateProjectEditCinematographyShotPlan,
  readProjectEditCinematographyShotPlan,
} from '@/lib/edit-script/service'
import {
  createEditCinematographyShotPlanRequestSchema,
  getEditCinematographyShotPlanRequestSchema,
} from '@/lib/edit-script/types'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const parsed = getEditCinematographyShotPlanRequestSchema.safeParse({
    episodeId: searchParams.get('episodeId'),
  })
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const cinematographyShotPlan = await readProjectEditCinematographyShotPlan({
    projectId,
    episodeId: parsed.data.episodeId,
  })
  return NextResponse.json({ cinematographyShotPlan })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = createEditCinematographyShotPlanRequestSchema.safeParse(body)
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const cinematographyShotPlan = await generateProjectEditCinematographyShotPlan({
    request,
    projectId,
    episodeId: parsed.data.episodeId,
    userId: authResult.session.user.id,
    locale: resolveRequiredTaskLocale(request, body),
    ...(parsed.data.editScriptId ? { editScriptId: parsed.data.editScriptId } : {}),
  })

  return NextResponse.json({ cinematographyShotPlan })
})
