import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { TASK_TYPE } from '@/lib/task/types'
import { maybeSubmitLLMTask } from '@/lib/llm-observe/route-task'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const payload = await request.json().catch(() => ({}))
  const propId = typeof payload?.propId === 'string' ? payload.propId.trim() : ''
  const variantId = typeof payload?.variantId === 'string' ? payload.variantId.trim() : ''
  const currentDescription = typeof payload?.currentDescription === 'string' ? payload.currentDescription.trim() : ''
  const modifyInstruction = typeof payload?.modifyInstruction === 'string' ? payload.modifyInstruction.trim() : ''

  if (!propId || !currentDescription || !modifyInstruction) {
    throw new ApiError('INVALID_PARAMS')
  }

  const prop = await prisma.globalLocation.findFirst({
    where: {
      id: propId,
      userId: session.user.id,
      assetKind: 'prop',
    },
    select: {
      id: true,
      name: true,
    },
  })
  if (!prop) {
    throw new ApiError('NOT_FOUND')
  }

  const asyncTaskResponse = await maybeSubmitLLMTask({
    request,
    userId: session.user.id,
    projectId: 'global-asset-hub',
    type: TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP,
    targetType: 'GlobalLocation',
    targetId: variantId || propId,
    routePath: '/api/asset-hub/ai-modify-prop',
    body: {
      propId,
      propName: prop.name,
      variantId: variantId || undefined,
      currentDescription,
      modifyInstruction,
    },
    dedupeKey: `asset_hub_ai_modify_prop:${propId}:${variantId || 'default'}`,
  })
  if (asyncTaskResponse) return asyncTaskResponse

  throw new ApiError('INVALID_PARAMS')
})
