import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const rawBody = await request.json().catch(() => ({}))
  const body = toObject(rawBody)
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject(body.meta)
  const characterId = normalizeString(body.characterId)
  const appearanceId = normalizeString(body.appearanceId)
  const count = normalizeImageGenerationCount('character', body.count)

  if (Object.prototype.hasOwnProperty.call(body, 'artStyle')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LEGACY_ART_STYLE_REMOVED',
      field: 'artStyle',
      message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
    })
  }

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const result = await executeProjectAgentOperationFromApi({
    request,
    operationId: 'generate_character_image',
    projectId,
    userId: authResult.session.user.id,
    context: {
      locale: taskLocale || normalizeString(bodyMeta.locale) || null,
    },
    input: {
      characterId,
      ...(appearanceId ? { appearanceId } : {}),
      ...(count ? { count } : {}),
    },
    source: 'project-ui',
  })

  return NextResponse.json(result)
})
