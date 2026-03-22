import OpenAI from 'openai'
import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { ensureBailianCodingPlanCatalogRegistered } from './catalog'

const DEFAULT_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1'

/**
 * 配置中心「测试链接」只发 hi + max_tokens:20，通常几秒内返回。
 * 业务侧（如角色视觉 JSON）提示词极长、输出也大，30s 很容易不够。
 *
 * OpenAI SDK 默认会在「请求超时」后自动重试（maxRetries=2 → 最多 3 次），
 * 单次 timeout 30s 时总等待约 90s 才抛错，看起来像「神秘 91s 超时」。
 */
const CODING_PLAN_COMPLETION_TIMEOUT_MS = 180_000

export interface BailianCodingPlanLlmCompletionParams {
  modelId: string
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  apiKey: string
  baseUrl?: string
  temperature?: number
}

function assertRegistered(modelId: string): void {
  ensureBailianCodingPlanCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'bailian-coding-plan',
    modality: 'llm' satisfies OfficialModelModality,
    modelId,
  })
}

export async function completeBailianCodingPlanLlm(
  params: BailianCodingPlanLlmCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  assertRegistered(params.modelId)
  const baseURL = typeof params.baseUrl === 'string' && params.baseUrl.trim()
    ? params.baseUrl.trim()
    : DEFAULT_BASE_URL
  const client = new OpenAI({
    apiKey: params.apiKey,
    baseURL,
    timeout: CODING_PLAN_COMPLETION_TIMEOUT_MS,
    /** Worker / BullMQ 已有重试；避免 SDK 再叠 3 倍 wall-clock */
    maxRetries: 0,
  })
  const completion = await client.chat.completions.create({
    model: params.modelId,
    messages: params.messages,
    temperature: params.temperature ?? 0.7,
  })
  return completion
}
