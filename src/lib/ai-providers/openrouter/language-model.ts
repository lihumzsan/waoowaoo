import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { AiLlmExecutionResult } from '@/lib/ai-registry/types'
import type {
  AiProviderLanguageModelContext,
  AiProviderLanguageModelValidationContext,
} from '@/lib/ai-providers/runtime-types'
import { applyOpenRouterPromptCaching } from '@/lib/ai-providers/openrouter/prompt-cache'
import { createScopedLogger } from '@/lib/logging/core'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { AppError } from '@/lib/errors/app-error'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { ProviderHttpError, readProviderJsonResponse } from '@/lib/ai-providers/failure'
import {
  classifyOpenRouterMachineErrorCode,
  isOpenRouterSensitiveRejection,
  OPENROUTER_CONTENT_POLICY_REJECTION_MESSAGE,
} from './error-normalization'

const openRouterLanguageModelLogger = createScopedLogger({
  module: 'ai-provider.openrouter.language-model',
})

const OPENROUTER_REJECTED_RESPONSE_STATUSES = new Set([400, 401, 402, 403, 404, 413])
const OPENROUTER_LANGUAGE_ERROR_FIELD_LIMIT = 1_000

function readOptionalHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)?.trim()
  return value || undefined
}

function readOpenRouterResponseTrace(headers: Headers): Record<string, string> {
  const generationId = readOptionalHeader(headers, 'x-generation-id')
  const upstreamProviderName = readOptionalHeader(headers, 'x-provider-name')
  const edgeRequestId = readOptionalHeader(headers, 'cf-ray')
  return {
    ...(generationId ? { generationId } : {}),
    ...(upstreamProviderName ? { upstreamProviderName } : {}),
    ...(edgeRequestId ? { edgeRequestId } : {}),
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readLimitedString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  return normalized ? normalized.slice(0, OPENROUTER_LANGUAGE_ERROR_FIELD_LIMIT) : null
}

type OpenRouterLanguageErrorEnvelope = {
  readonly message: string
  readonly errorType: string | null
  readonly metadata: Record<string, unknown> | null
  readonly raw: unknown
}

async function readOpenRouterLanguageErrorEnvelope(
  response: Response,
): Promise<OpenRouterLanguageErrorEnvelope | null> {
  if (!OPENROUTER_REJECTED_RESPONSE_STATUSES.has(response.status)) return null
  const body = await readProviderJsonResponse({
    response,
    provider: 'openrouter',
    phase: 'submit',
  })
  const envelope = asRecord(body)
  const error = asRecord(envelope?.error)
  const message = readLimitedString(error?.message)
  if (!error || !message) {
    throw new ProviderHttpError({
      provider: 'openrouter',
      phase: 'submit',
      statusCode: response.status,
      requestId: readOptionalHeader(response.headers, 'x-request-id')
        ?? readOptionalHeader(response.headers, 'cf-ray'),
      contentType: response.headers.get('content-type'),
      diagnosticText: `OpenRouter returned an unrecognized HTTP ${String(response.status)} error response`,
      errorEnvelope: body,
    })
  }
  const metadata = asRecord(error.metadata)
  return {
    message,
    errorType: readLimitedString(metadata?.error_type)
      ?? readLimitedString(error.type)
      ?? readLimitedString(error.code),
    metadata,
    raw: body,
  }
}

function throwOpenRouterLanguageSubmissionRejection(input: {
  readonly response: Response
  readonly envelope: OpenRouterLanguageErrorEnvelope
}): never {
  const sensitive = isOpenRouterSensitiveRejection(
    input.envelope.errorType,
    input.envelope.metadata,
  )
  const code = sensitive
    ? 'SENSITIVE_CONTENT'
    : classifyOpenRouterMachineErrorCode(input.envelope.errorType)
      ?? (input.response.status === 401 || input.response.status === 403
        ? 'PROVIDER_AUTH_INVALID'
        : input.response.status === 402
          ? 'PROVIDER_BILLING_REQUIRED'
          : 'PROVIDER_SUBMISSION_REJECTED')
  throw new ProviderSubmissionError(
    code,
    sensitive ? OPENROUTER_CONTENT_POLICY_REJECTION_MESSAGE : input.envelope.message,
    {
      disposition: 'rejected',
      provider: 'openrouter',
      details: {
        providerStatus: input.response.status,
        ...(input.envelope.errorType
          ? { providerErrorType: input.envelope.errorType }
          : {}),
      },
      cause: {
        name: 'OpenRouterHttpError',
        message: input.envelope.message,
        code: input.envelope.errorType,
        statusCode: input.response.status,
        errorEnvelope: input.envelope.raw,
      },
    },
  )
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  const bodyText = typeof init?.body === 'string'
    ? init.body
    : typeof Request !== 'undefined' && input instanceof Request
      ? await input.clone().text()
      : ''
  if (!bodyText) throw new Error('OPENROUTER_LANGUAGE_MODEL_REQUEST_BODY_MISSING')
  const body = asRecord(JSON.parse(bodyText) as unknown)
  if (!body) throw new Error('OPENROUTER_LANGUAGE_MODEL_REQUEST_BODY_INVALID')
  return body
}

function createOpenRouterLoggingFetch(input: AiProviderLanguageModelContext): typeof fetch {
  return async (requestInput, requestInit) => {
    const startedAt = Date.now()
    const body = await readRequestBody(requestInput, requestInit)
    const nextBody = JSON.stringify(applyOpenRouterPromptCaching({
      modelId: input.selection.modelId,
      body,
      sourceMessages: input.messages,
    }))
    const preparedInput = typeof Request !== 'undefined' && requestInput instanceof Request
      ? new Request(requestInput, { body: nextBody })
      : requestInput
    const preparedInit = typeof requestInit?.body === 'string'
      ? { ...requestInit, body: nextBody }
      : requestInit
    const response = await fetchWithProviderProxy(preparedInput, preparedInit)
    openRouterLanguageModelLogger.info({
      action: 'openrouter.language_model.response',
      message: 'OpenRouter language model response',
      provider: 'openrouter',
      durationMs: Date.now() - startedAt,
      details: {
        url: requestUrl(requestInput),
        status: response.status,
        statusText: response.statusText,
        ...readOpenRouterResponseTrace(response.headers),
        openRouterSessionId: input.openRouterSessionId ?? null,
      },
    })
    const errorEnvelope = await readOpenRouterLanguageErrorEnvelope(response)
    if (errorEnvelope) {
      throwOpenRouterLanguageSubmissionRejection({ response, envelope: errorEnvelope })
    }
    return response
  }
}

export function createOpenRouterLanguageModel(input: AiProviderLanguageModelContext) {
  if (input.protocol !== 'openrouter-chat') {
    throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:openrouter:${input.protocol}`)
  }
  const baseURL = input.providerConfig.baseUrl?.trim()
  if (!baseURL) throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (language-model)')
  const openRouter = createOpenRouter({
    baseURL,
    apiKey: input.providerConfig.apiKey,
    compatibility: 'strict',
    fetch: createOpenRouterLoggingFetch(input),
    ...(input.openRouterSessionId
      ? { headers: { 'x-session-id': input.openRouterSessionId } }
      : {}),
  })
  const model = openRouter.chat(input.selection.modelId, {
    usage: { include: true },
    ...(input.reasoning
      ? {
          extraBody: {
            reasoning: {
              effort: input.reasoningEffort,
              ...(input.publicReasoningMode === 'summary_auto' ? { summary: 'auto' } : {}),
            },
          },
        }
      : {}),
  })
  return model
}

export function validateOpenRouterLanguageModelResult(
  result: AiLlmExecutionResult,
  context: AiProviderLanguageModelValidationContext,
): void {
  if (context.executionMode === 'vision') return
  if (result.termination.kind === 'token_limit') {
    throw new AppError('MODEL_OUTPUT_TRUNCATED', 'OpenRouter output reached the token limit', {
      provider: 'openrouter',
      details: {
        rawReason: result.termination.rawReason,
        textChars: result.text.length,
        reasoningChars: result.reasoning.length,
      },
      cause: result,
    })
  }
  if (context.executionMode === 'stream' && result.termination.kind === 'safety') {
    throw new AppError('SENSITIVE_CONTENT', 'OpenRouter blocked the response for safety reasons', {
      provider: 'openrouter',
      details: { rawReason: result.termination.rawReason },
      cause: result,
    })
  }
  if (context.executionMode === 'stream' && result.termination.kind === 'unknown') {
    throw new AppError('EXTERNAL_ERROR', 'OpenRouter stream ended without a recognized final status', {
      provider: 'openrouter',
      details: { rawReason: result.termination.rawReason },
      cause: result,
    })
  }
  if (!result.text.trim()) {
    throw new AppError('EMPTY_RESPONSE', 'OpenRouter returned no response body', {
      provider: 'openrouter',
      details: {
        rawReason: result.termination.rawReason,
        textChars: 0,
        reasoningChars: result.reasoning.length,
      },
      cause: result,
    })
  }
}
