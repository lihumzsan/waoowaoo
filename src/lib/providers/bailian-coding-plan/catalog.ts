import { registerOfficialModel } from '@/lib/providers/official/model-registry'

/** 阿里云百炼 Coding Plan 支持的文本模型（仅 llm） */
const BAILIAN_CODING_PLAN_LLM_MODELS = [
  'qwen3.5-plus',
  'qwen3-max-2026-01-23',
  'qwen3-coder-next',
  'qwen3-coder-plus',
  'glm-5',
  'glm-4.7',
  'kimi-k2.5',
  'MiniMax-M2.5',
] as const

let initialized = false

export function ensureBailianCodingPlanCatalogRegistered(): void {
  if (initialized) return
  initialized = true
  for (const modelId of BAILIAN_CODING_PLAN_LLM_MODELS) {
    registerOfficialModel({ provider: 'bailian-coding-plan', modality: 'llm', modelId })
  }
}
