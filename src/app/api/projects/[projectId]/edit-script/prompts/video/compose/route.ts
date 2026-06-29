import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { generateEditStoryboardRequestSchema } from '@/lib/edit-script/types'
import { submitEditVideoPromptComposeTask } from '@/lib/edit-script/prompt-composer/submit'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = generateEditStoryboardRequestSchema.safeParse(body)
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const result = await submitEditVideoPromptComposeTask({
    request,
    projectId,
    episodeId: parsed.data.episodeId,
    userId: authResult.session.user.id,
    source: 'project-ui',
    confirmed: true,
    locale: resolveRequiredTaskLocale(request, body),
    ...(parsed.data.editScriptId ? { editScriptId: parsed.data.editScriptId } : {}),
  })

  return NextResponse.json(result)
})
