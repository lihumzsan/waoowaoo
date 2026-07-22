import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuthLight } from '@/lib/api-auth'
import {
  getEditBibleInputSchema,
  readEpisodeEditBible,
  readEpisodeEditChapters,
} from '@/lib/edit-bible'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const parsed = getEditBibleInputSchema.safeParse({
    episodeId: searchParams.get('episodeId'),
  })
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const [editBible, chapters] = await Promise.all([
    readEpisodeEditBible({
      projectId,
      episodeId: parsed.data.episodeId,
    }),
    readEpisodeEditChapters({
      projectId,
      episodeId: parsed.data.episodeId,
    }),
  ])
  return NextResponse.json({
    editBible: editBible ? { ...editBible, chapters } : null,
    chapters,
  })
})
