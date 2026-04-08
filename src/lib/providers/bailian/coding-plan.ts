export const BAILIAN_CODING_PLAN_LLM_MODEL_IDS = [
  'qwen3.5-plus',
  'glm-5',
  'kimi-k2.5',
] as const

const BAILIAN_CODING_PLAN_LLM_MODEL_ID_SET = new Set<string>(BAILIAN_CODING_PLAN_LLM_MODEL_IDS)

export function isBailianCodingPlanSupportedLlmModel(modelId?: string): boolean {
  const trimmed = typeof modelId === 'string' ? modelId.trim() : ''
  return BAILIAN_CODING_PLAN_LLM_MODEL_ID_SET.has(trimmed)
}

export function isBailianCodingPlanSupportedModel(params: {
  modelId?: string
  type?: string
}): boolean {
  return params.type === 'llm' && isBailianCodingPlanSupportedLlmModel(params.modelId)
}

export function listBailianCodingPlanProbeModelIds(
  preferredModelIds: ReadonlyArray<string | undefined> = [],
): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()

  const push = (value?: string) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    ordered.push(trimmed)
  }

  preferredModelIds.forEach((modelId) => push(modelId))
  BAILIAN_CODING_PLAN_LLM_MODEL_IDS.forEach((modelId) => push(modelId))

  return ordered
}
