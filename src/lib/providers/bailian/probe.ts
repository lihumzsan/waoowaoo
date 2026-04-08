import type { BailianProbeResult, BailianProbeStep } from './types'
import { buildBailianCompatibleUrl, isBailianCodingPlanApiKey } from './base-url'
import { listBailianCodingPlanProbeModelIds } from './coding-plan'

const BAILIAN_CREDITS_UNSUPPORTED_MESSAGE = 'Not supported by Bailian probe API'
const BAILIAN_CODING_PLAN_PROBE_PROMPT = 'ping'

function classifyStatus(status: number): string {
  if (status === 401 || status === 403) return `Authentication failed (${status})`
  if (status === 429) return `Rate limited (${status})`
  return `Provider error (${status})`
}

function toNetworkErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Network error: ${message}`
}

function sliceDetail(detail: string): string {
  return detail.slice(0, 500)
}

function canRetryCodingPlanModel(status: number): boolean {
  return status === 400 || status === 404 || status === 422
}

function readAssistantText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined

  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) return undefined

  const message = (firstChoice as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined

  const content = (message as { content?: unknown }).content
  if (typeof content === 'string' && content.trim()) {
    return content.trim()
  }

  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue
    const text = (part as { text?: unknown }).text
    if (typeof text === 'string' && text.trim()) {
      return text.trim()
    }
  }

  return undefined
}

async function probeBailianOfficial(apiKey: string): Promise<BailianProbeResult> {
  const steps: BailianProbeStep[] = []
  try {
    const response = await fetch(buildBailianCompatibleUrl({ apiKey }, '/models'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      steps.push({
        name: 'models',
        status: 'fail',
        message: classifyStatus(response.status),
        detail: sliceDetail(detail),
      })
      steps.push({
        name: 'credits',
        status: 'skip',
        message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
      })
      return { success: false, steps }
    }
    const data = await response.json() as { data?: Array<{ id?: string }> }
    const models = Array.isArray(data.data) ? data.data : []
    const firstModel = models.find((item) => typeof item.id === 'string')?.id
    steps.push({
      name: 'models',
      status: 'pass',
      message: `Found ${models.length} models`,
      ...(firstModel ? { model: firstModel } : {}),
    })
    steps.push({
      name: 'credits',
      status: 'skip',
      message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
    })
    return {
      success: true,
      steps,
      ...(firstModel ? { model: firstModel } : {}),
    }
  } catch (error) {
    steps.push({
      name: 'models',
      status: 'fail',
      message: toNetworkErrorMessage(error),
    })
    steps.push({
      name: 'credits',
      status: 'skip',
      message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
    })
    return { success: false, steps }
  }
}

async function probeBailianCodingPlan(params: {
  apiKey: string
  preferredModelIds?: ReadonlyArray<string | undefined>
}): Promise<BailianProbeResult> {
  const steps: BailianProbeStep[] = []
  const headers = {
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  }
  let lastFailure: BailianProbeStep | null = null

  for (const modelId of listBailianCodingPlanProbeModelIds(params.preferredModelIds)) {
    try {
      const response = await fetch(buildBailianCompatibleUrl({ apiKey: params.apiKey }, '/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: BAILIAN_CODING_PLAN_PROBE_PROMPT }],
          max_tokens: 8,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20_000),
      })

      const detail = await response.text().catch(() => '')
      if (response.ok) {
        let answer = ''
        if (detail.trim()) {
          try {
            answer = readAssistantText(JSON.parse(detail) as unknown) || ''
          } catch {
            answer = ''
          }
        }

        steps.push({
          name: 'textGen',
          status: 'pass',
          model: modelId,
          message: answer ? `Response: ${answer.slice(0, 80)}` : 'Text generation probe succeeded',
        })
        steps.push({
          name: 'credits',
          status: 'skip',
          message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
        })
        return {
          success: true,
          steps,
          model: modelId,
          ...(answer ? { answer } : {}),
        }
      }

      const failure: BailianProbeStep = {
        name: 'textGen',
        status: 'fail',
        model: modelId,
        message: classifyStatus(response.status),
        detail: sliceDetail(detail),
      }

      if (response.status === 401 || response.status === 403 || response.status === 429) {
        steps.push(failure)
        steps.push({
          name: 'credits',
          status: 'skip',
          message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
        })
        return { success: false, steps }
      }

      lastFailure = failure
      if (!canRetryCodingPlanModel(response.status)) {
        steps.push(failure)
        steps.push({
          name: 'credits',
          status: 'skip',
          message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
        })
        return { success: false, steps }
      }
    } catch (error) {
      steps.push({
        name: 'textGen',
        status: 'fail',
        model: modelId,
        message: toNetworkErrorMessage(error),
      })
      steps.push({
        name: 'credits',
        status: 'skip',
        message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
      })
      return { success: false, steps }
    }
  }

  steps.push(lastFailure ?? {
    name: 'textGen',
    status: 'fail',
    message: 'No supported Coding Plan text model responded',
  })
  steps.push({
    name: 'credits',
    status: 'skip',
    message: BAILIAN_CREDITS_UNSUPPORTED_MESSAGE,
  })
  return { success: false, steps }
}

export async function probeBailian(params: {
  apiKey: string
  preferredModelIds?: ReadonlyArray<string | undefined>
}): Promise<BailianProbeResult> {
  if (isBailianCodingPlanApiKey(params.apiKey)) {
    return probeBailianCodingPlan(params)
  }
  return probeBailianOfficial(params.apiKey)
}
