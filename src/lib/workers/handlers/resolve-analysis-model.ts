import { composeModelKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { getUserModelConfig } from '@/lib/config-service'

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

export async function resolveAnalysisModel(input: ResolveAnalysisModelInput): Promise<string> {
  const modelFromInput = normalizeModelKey(input.inputModel)
  if (modelFromInput) return modelFromInput

  const modelFromProject = normalizeModelKey(input.projectAnalysisModel)
  if (modelFromProject) return modelFromProject

  const userConfig = await getUserModelConfig(input.userId)
  const modelFromUserConfig = normalizeModelKey(userConfig.analysisModel)
  if (modelFromUserConfig) return modelFromUserConfig

  throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
}
