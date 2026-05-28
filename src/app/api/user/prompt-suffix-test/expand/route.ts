import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { expandPromptSuffixTestIdea } from '@/lib/prompt-suffix-test/service'

const requestSchema = z.object({
  idea: z.string().trim().min(1).max(4000),
  locale: z.enum(['zh', 'en']),
  aspectRatio: z.string().trim().min(1).max(32),
  styleText: z.string().trim().min(1).max(4000),
  styleBibleText: z.string().trim().min(1).max(12000),
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const parsed = requestSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_SUFFIX_TEST_EXPAND_INVALID_INPUT',
      issues: parsed.error.issues,
    })
  }

  try {
    const { session } = authResult
    const result = await expandPromptSuffixTestIdea({
      userId: session.user.id,
      locale: parsed.data.locale,
      idea: parsed.data.idea,
      aspectRatio: parsed.data.aspectRatio,
      styleText: parsed.data.styleText,
      styleBibleText: parsed.data.styleBibleText,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'PROMPT_SUFFIX_TEST_ANALYSIS_MODEL_REQUIRED') {
      throw error
    }
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_SUFFIX_TEST_ANALYSIS_MODEL_REQUIRED',
      field: 'analysisModel',
    })
  }
})
