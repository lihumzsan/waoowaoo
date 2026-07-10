import type OpenAI from 'openai'
import type { AiLlmExecutionResult, AiLlmTermination, AiLlmUsage } from '@/lib/ai-registry/types'
import { completionUsageSummary } from '@/lib/ai-providers/shared/llm-support'

export function buildAiProviderLlmResult(input: {
  completion: OpenAI.Chat.Completions.ChatCompletion
  logProvider: string
  text: string
  reasoning: string
  termination?: AiLlmTermination
  usage?: AiLlmUsage | null
  successDetails?: { [key: string]: unknown }
}): Pick<
  AiLlmExecutionResult,
  'completion' | 'logProvider' | 'text' | 'reasoning' | 'termination' | 'usage' | 'successDetails'
> {
  const rawReason = input.completion.choices[0]?.finish_reason ?? null
  const termination = input.termination ?? {
    kind: rawReason === 'length'
      ? 'token_limit' as const
      : rawReason === 'content_filter'
        ? 'safety' as const
        : rawReason === 'tool_calls' || rawReason === 'function_call'
          ? 'tool_call' as const
          : rawReason === 'stop'
            ? 'normal' as const
            : 'unknown' as const,
    rawReason,
  }
  return {
    completion: input.completion,
    logProvider: input.logProvider,
    text: input.text,
    reasoning: input.reasoning,
    termination,
    usage: input.usage ?? completionUsageSummary(input.completion),
    successDetails: input.successDetails,
  }
}
