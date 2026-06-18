import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  readProjectEditDirectorDecoupage,
} from '@/lib/edit-script/service'
import { submitProjectEditDirectorDecoupageTask } from '@/lib/edit-script/task-submission'
import {
  createEditDirectorDecoupageRequestSchema,
  getEditDirectorDecoupageRequestSchema,
} from '@/lib/edit-script/types'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const parsed = getEditDirectorDecoupageRequestSchema.safeParse({
    episodeId: searchParams.get('episodeId'),
  })
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const directorDecoupage = await readProjectEditDirectorDecoupage({
    projectId,
    episodeId: parsed.data.episodeId,
  })
  return NextResponse.json({ directorDecoupage })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = createEditDirectorDecoupageRequestSchema.safeParse(body)
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const result = await submitProjectEditDirectorDecoupageTask({
    request,
    projectId,
    episodeId: parsed.data.episodeId,
    userId: authResult.session.user.id,
    source: 'project-ui',
    confirmed: true,
    locale: resolveRequiredTaskLocale(request, body),
    ...(parsed.data.screenplayId ? { screenplayId: parsed.data.screenplayId } : {}),
  })

  return NextResponse.json(result)
})
