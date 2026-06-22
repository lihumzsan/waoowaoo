import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'

export const EDIT_FIRST_TEXT_TASK_MAX_INPUT_TOKENS = 12_000

export function buildEditFirstTextTaskPayloadFromAnalysisModel(input: {
  readonly analysisModel: string
  readonly payload: Record<string, unknown>
}): Record<string, unknown> {
  const analysisModel = input.analysisModel.trim()
  if (!analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit-first text task billing',
    })
  }
  return {
    ...input.payload,
    analysisModel,
    maxInputTokens: EDIT_FIRST_TEXT_TASK_MAX_INPUT_TOKENS,
  }
}

export async function buildEditFirstTextTaskPayload(input: {
  readonly projectId: string
  readonly userId: string
  readonly payload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  if (!config.analysisModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MISSING_ANALYSIS_MODEL',
      message: 'Analysis model is required for edit-first text task billing',
    })
  }
  return buildEditFirstTextTaskPayloadFromAnalysisModel({
    analysisModel: config.analysisModel,
    payload: input.payload,
  })
}
