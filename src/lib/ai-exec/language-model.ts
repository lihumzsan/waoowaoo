import type { LanguageModel } from 'ai'
import {
  createRegisteredLanguageModel,
  prepareRegisteredTextModelMessages,
  validateRegisteredLanguageModelResult,
} from '@/lib/ai-providers'
import type { AiProviderLanguageModelRequestContext } from '@/lib/ai-providers/runtime-types'
import type { AiProviderLanguageModelValidationContext } from '@/lib/ai-providers/runtime-types'
import type { AiLlmExecutionResult, AiLlmMessage } from '@/lib/ai-registry/types'
import type { ModelMessage } from 'ai'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'

export function createAiLanguageModel(input: AiProviderLanguageModelRequestContext): LanguageModel {
  ensureAiCatalogsRegistered()
  return createRegisteredLanguageModel(input)
}

export function prepareAiTextModelMessages(providerId: string, messages: AiLlmMessage[]): ModelMessage[] {
  return prepareRegisteredTextModelMessages(providerId, messages)
}

export function validateAiLanguageModelResult(
  providerId: string,
  result: AiLlmExecutionResult,
  context: AiProviderLanguageModelValidationContext,
): void {
  validateRegisteredLanguageModelResult(providerId, result, context)
}
