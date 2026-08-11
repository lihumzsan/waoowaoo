import { generateText, streamText, type ModelMessage } from 'ai'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { AppError } from '@/lib/errors/app-error'
import { createAiLanguageModel, validateAiLanguageModelResult } from '@/lib/ai-exec/language-model'
import {
  emitStreamChunk,
  emitStreamStage,
  resolveStreamStepMeta,
  withStreamChunkTimeout,
} from '@/lib/ai-providers/shared/llm-support'
import type {
  AiLlmExecutionResult,
  AiLlmMessage,
  AiLlmProviderConfig,
  AiResolvedLlmSelection,
  AiLlmCallOptions,
  AiLlmStreamCallbacks,
} from '@/lib/ai-registry/types'
import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'
import {
  projectAiSdkLanguageModelResult,
  reconcileAiSdkStreamFinal,
  type AiSdkLanguageModelResult,
} from '@/lib/ai-exec/llm/result-projector'
import { runRegisteredProviderOperation } from '@/lib/ai-providers'

export type AiSdkRunnerInput = {
  providerKey: string
  selection: AiResolvedLlmSelection
  providerConfig: AiLlmProviderConfig
  modelMessages: ModelMessage[]
  sourceMessages?: AiLlmMessage[]
  reasoning: boolean
  reasoningEffort: ReasoningEffort
  modality: 'llm' | 'vision'
  executionMode: 'sync' | 'stream'
  openRouterSessionId?: string
  options: AiLlmCallOptions
  callbacks?: AiLlmStreamCallbacks
}

function createModel(input: AiSdkRunnerInput) {
  return createAiLanguageModel({
    providerKey: input.providerKey,
    selection: input.selection,
    providerConfig: input.providerConfig,
    executionMode: input.modality === 'vision' ? 'vision' : input.executionMode,
    reasoning: input.reasoning,
    reasoningEffort: input.reasoningEffort,
    messages: input.sourceMessages,
    openRouterSessionId: input.openRouterSessionId,
  })
}

function projectAndValidate(input: AiSdkRunnerInput, result: AiSdkLanguageModelResult): AiLlmExecutionResult {
  const projected = projectAiSdkLanguageModelResult({
    provider: input.providerKey,
    modelId: input.selection.modelId,
    result,
  })
  try {
    validateAiLanguageModelResult(input.selection.provider, projected, {
      executionMode: input.modality === 'vision' ? 'vision' : input.executionMode,
    })
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    throw new ProviderSubmissionError(error.code, error.message, {
      disposition: 'rejected',
      provider: input.selection.provider,
      details: error.details,
      context: {
        system: 'provider',
        provider: input.selection.provider,
        phase: 'result',
      },
      cause: error,
    })
  }
  return projected
}

async function runSync(input: AiSdkRunnerInput): Promise<AiLlmExecutionResult> {
  const result = await generateText({
    model: createModel(input),
    messages: input.modelMessages,
    maxRetries: 0,
  })
  return projectAndValidate(input, result)
}

async function runStream(input: AiSdkRunnerInput): Promise<AiLlmExecutionResult> {
  const stepMeta = resolveStreamStepMeta(input.options)
  const result = streamText({
    model: createModel(input),
    messages: input.modelMessages,
    maxRetries: 0,
  })
  emitStreamStage(input.callbacks, stepMeta, 'streaming', input.providerKey)

  let streamedText = ''
  let streamedReasoning = ''
  let seq = 1
  for await (const chunk of withStreamChunkTimeout(result.fullStream)) {
    if (chunk.type === 'reasoning-delta' && chunk.text) {
      streamedReasoning += chunk.text
      emitStreamChunk(input.callbacks, stepMeta, {
        kind: 'reasoning',
        delta: chunk.text,
        seq,
        lane: 'reasoning',
      })
      seq += 1
    }
    if (chunk.type === 'text-delta' && chunk.text) {
      streamedText += chunk.text
      emitStreamChunk(input.callbacks, stepMeta, {
        kind: 'text',
        delta: chunk.text,
        seq,
        lane: 'main',
      })
      seq += 1
    }
  }

  const [finalText, finalReasoning, finishReason, rawFinishReason, usage, response, providerMetadata] = await Promise.all([
    result.text,
    result.reasoningText,
    result.finishReason,
    result.rawFinishReason,
    result.usage,
    result.response,
    result.providerMetadata,
  ])
  const reconciledText = reconcileAiSdkStreamFinal(streamedText, finalText, 'text')
  const reconciledReasoning = reconcileAiSdkStreamFinal(streamedReasoning, finalReasoning || '', 'reasoning')
  if (reconciledReasoning.suffix) {
    emitStreamChunk(input.callbacks, stepMeta, {
      kind: 'reasoning',
      delta: reconciledReasoning.suffix,
      seq,
      lane: 'reasoning',
    })
    seq += 1
  }
  if (reconciledText.suffix) {
    emitStreamChunk(input.callbacks, stepMeta, {
      kind: 'text',
      delta: reconciledText.suffix,
      seq,
      lane: 'main',
    })
  }

  const projected = projectAndValidate(input, {
    text: reconciledText.value,
    reasoningText: reconciledReasoning.value,
    finishReason,
    rawFinishReason,
    usage,
    response,
    providerMetadata,
  })
  emitStreamStage(input.callbacks, stepMeta, 'completed', input.providerKey)
  input.callbacks?.onComplete?.(projected.text, stepMeta)
  return projected
}

export async function runAiSdkLanguageModel(input: AiSdkRunnerInput): Promise<AiLlmExecutionResult> {
  return await runRegisteredProviderOperation({
    providerId: input.selection.provider,
    phase: input.executionMode === 'stream' ? 'stream' : 'submit',
    run: async () => input.executionMode === 'stream'
      ? await runStream(input)
      : await runSync(input),
  })
}
