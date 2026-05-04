import { getModelsByType, getProviderKey } from '@/lib/api-config'
import { composeModelKey, parseModelKeyStrict } from '@/lib/model-config-contract'
import { prisma } from '@/lib/prisma'

type ResolveAnalysisModelInput = {
  userId: string
  inputModel?: unknown
  projectAnalysisModel?: unknown
}

function normalizeModelKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parseModelKeyStrict(trimmed)
  if (!parsed) return null
  return composeModelKey(parsed.provider, parsed.modelId)
}

function pickEnabledLlmModelKey(
  modelKey: string | null,
  enabledModelKeys: Set<string>,
  providerFallbacks: Map<string, string>,
): string | null {
  if (!modelKey) return null
  if (enabledModelKeys.has(modelKey)) return modelKey
  return providerFallbacks.get(getProviderKey(modelKey)) || null
}

export async function resolveAnalysisModel(input: ResolveAnalysisModelInput): Promise<string> {
  const enabledModels = await getModelsByType(input.userId, 'llm')
  const enabledModelKeys = new Set(enabledModels.map((model) => model.modelKey))
  const providerFallbacks = new Map<string, string>()

  for (const model of enabledModels) {
    const providerKey = getProviderKey(model.provider)
    if (!providerFallbacks.has(providerKey)) {
      providerFallbacks.set(providerKey, model.modelKey)
    }
  }

  const modelFromInput = pickEnabledLlmModelKey(
    normalizeModelKey(input.inputModel),
    enabledModelKeys,
    providerFallbacks,
  )
  if (modelFromInput) return modelFromInput

  const modelFromProject = pickEnabledLlmModelKey(
    normalizeModelKey(input.projectAnalysisModel),
    enabledModelKeys,
    providerFallbacks,
  )
  if (modelFromProject) return modelFromProject

  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: input.userId },
    select: { analysisModel: true },
  })
  const modelFromUserPreference = pickEnabledLlmModelKey(
    normalizeModelKey(userPreference?.analysisModel),
    enabledModelKeys,
    providerFallbacks,
  )
  if (modelFromUserPreference) return modelFromUserPreference

  if (enabledModels.length === 1) {
    return enabledModels[0].modelKey
  }

  throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
}
