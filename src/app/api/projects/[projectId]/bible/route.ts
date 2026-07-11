import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth, requireProjectAuthLight } from '@/lib/api-auth'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  confirmEpisodeEditBible,
  confirmEditBibleInputSchema,
  getEditBibleInputSchema,
  ingestEditBibleScriptInputSchema,
  readEpisodeEditBible,
  readEpisodeEditChapters,
  reviseEditBibleInputSchema,
  reviseEpisodeEditBible,
  submitProjectEditBibleGenerationTask,
} from '@/lib/edit-bible'

const patchEditBibleRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('confirm'),
    ...confirmEditBibleInputSchema.shape,
  }),
  z.object({
    action: z.literal('revise'),
    ...reviseEditBibleInputSchema.shape,
  }),
])

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

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = ingestEditBibleScriptInputSchema.safeParse(body)
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  const result = await submitProjectEditBibleGenerationTask({
    request,
    projectId,
    userId: authResult.session.user.id,
    episodeId: parsed.data.episodeId,
    sourceKind: parsed.data.sourceKind,
    text: parsed.data.text,
    ...(parsed.data.rawFileMediaId ? { rawFileMediaId: parsed.data.rawFileMediaId } : {}),
    source: 'project-ui',
    locale: resolveRequiredTaskLocale(request, body),
  })

  return NextResponse.json(result)
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as unknown
  const parsed = patchEditBibleRequestSchema.safeParse(body)
  if (!parsed.success) throw new ApiError('INVALID_PARAMS')

  if (parsed.data.action === 'confirm') {
    const editBible = await confirmEpisodeEditBible({
      projectId,
      userId: authResult.session.user.id,
      episodeId: parsed.data.episodeId,
    })
    return NextResponse.json({ editBible })
  }

  const result = await reviseEpisodeEditBible({
    projectId,
    userId: authResult.session.user.id,
    episodeId: parsed.data.episodeId,
    patch: {
      ...(parsed.data.bible ? { bible: parsed.data.bible } : {}),
      ...(parsed.data.beatSheet ? { beatSheet: parsed.data.beatSheet } : {}),
      ...(parsed.data.ledger ? { ledger: parsed.data.ledger } : {}),
      ...(parsed.data.emotionalCurve ? { emotionalCurve: parsed.data.emotionalCurve } : {}),
    },
  })
  return NextResponse.json(result)
})
