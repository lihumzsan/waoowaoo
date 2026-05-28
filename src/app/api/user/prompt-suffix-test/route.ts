import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { runPromptSuffixImageTest } from '@/lib/prompt-suffix-test/service'

const requestSchema = z.object({
  modelKey: z.string().trim().min(1),
  variantId: z.string().trim().min(1).max(80),
  finalPrompt: z.string().trim().min(1).max(48000),
  aspectRatio: z.string().trim().min(1).max(32),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const parsed = requestSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_SUFFIX_TEST_INVALID_INPUT',
      issues: parsed.error.issues,
    })
  }

  const { session } = authResult
  try {
    const result = await runPromptSuffixImageTest({
      userId: session.user.id,
      modelKey: parsed.data.modelKey,
      variantId: parsed.data.variantId,
      finalPrompt: parsed.data.finalPrompt,
      aspectRatio: parsed.data.aspectRatio,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('PROMPT_SUFFIX_TEST_IMAGE_MODEL_INVALID:')) {
      throw error
    }
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_SUFFIX_TEST_IMAGE_MODEL_INVALID',
      modelKey: parsed.data.modelKey,
    })
  }
})
