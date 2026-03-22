import { prisma } from '@/lib/prisma'
import { composeModelKey, parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProjectModelConfig } from '@/lib/config-service'
import { getProviderKey } from '@/lib/api-config'

export type ResolveAnalysisModelInput = {
  userId: string
  inputModel?: unknown
  /**
   * 若提供：与 getProjectModelConfig 一致（项目分析模型 → 用户默认分析模型）
   */
  projectId?: string
  /**
   * 仅在不传 projectId 时使用（兼容旧调用）
   */
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

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 未在偏好/项目中指定分析模型时：从 customModels 里已启用的 LLM 中选（优先 bailian-coding-plan） */
async function pickFallbackEnabledLlmModelKey(userId: string): Promise<string | null> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customModels: true },
  })
  if (!pref?.customModels?.trim()) return null

  let rows: unknown
  try {
    rows = JSON.parse(pref.customModels) as unknown
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null

  const llmRows = rows.filter((r): r is Record<string, unknown> => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false
    if (r.type !== 'llm') return false
    if (r.enabled === false) return false
    return true
  })
  if (llmRows.length === 0) return null

  const rowToKey = (row: Record<string, unknown>): string | null => {
    const fromKey = normalizeModelKey(readTrimmed(row.modelKey))
    if (fromKey) return fromKey
    const provider = readTrimmed(row.provider)
    const modelId = readTrimmed(row.modelId)
    if (!provider || !modelId) return null
    return composeModelKey(provider, modelId)
  }

  const codingPlan = llmRows.find((r) => getProviderKey(readTrimmed(r.provider)) === 'bailian-coding-plan')
  const pick = codingPlan ?? llmRows[0]
  return rowToKey(pick)
}

export async function resolveAnalysisModel(input: ResolveAnalysisModelInput): Promise<string> {
  const modelFromInput = normalizeModelKey(input.inputModel)
  if (modelFromInput) return modelFromInput

  if (input.projectId) {
    const config = await getProjectModelConfig(input.projectId, input.userId)
    const fromMerged = normalizeModelKey(config.analysisModel)
    if (fromMerged) return fromMerged
  } else {
    const modelFromProject = normalizeModelKey(input.projectAnalysisModel)
    if (modelFromProject) return modelFromProject

    const userPreference = await prisma.userPreference.findUnique({
      where: { userId: input.userId },
      select: { analysisModel: true },
    })
    const modelFromUserPreference = normalizeModelKey(userPreference?.analysisModel)
    if (modelFromUserPreference) return modelFromUserPreference
  }

  const fallback = await pickFallbackEnabledLlmModelKey(input.userId)
  if (fallback) return fallback

  throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
}
