import type { UIMessage } from 'ai'
import { generateText } from 'ai'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { createAiLanguageModel } from '@/lib/ai-exec/language-model'
import { resolveLlmRuntimeModel } from '@/lib/ai-exec/llm-runtime'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import { resolveUtilityModelKey } from '@/lib/ai-exec/utility-model'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import type { ProjectAgentLocale } from '../locale'
import {
  PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION,
  buildProjectAgentSummaryTranscript,
  projectAgentConversationSummarySchema,
  type ProjectAgentConversationSummary,
} from './summary'

/**
 * Extends a stored conversation summary with newly aged-out messages.
 *
 * Runs on the utility model rather than the Primary Agent's: this is short
 * mechanical work, and doing it on the conversation model would mean paying
 * top-tier rates to compress text nobody reads.
 *
 * One model call, no retry. If it fails the caller falls back to shedding more
 * recoverable context; a failed summary is a missed optimisation, never a
 * reason to fail the user's turn.
 */
export async function extendProjectAgentConversationSummary(input: {
  userId: string
  locale: ProjectAgentLocale
  previous: ProjectAgentConversationSummary | null
  newlySummarized: readonly UIMessage[]
  signal?: AbortSignal
}): Promise<ProjectAgentConversationSummary | null> {
  const watermark = input.newlySummarized[input.newlySummarized.length - 1]
  if (!watermark) return input.previous

  const transcript = buildProjectAgentSummaryTranscript(input.newlySummarized)
  if (!transcript.trim()) return input.previous

  const modelKey = await resolveUtilityModelKey(input.userId)
  const selection = await resolveLlmRuntimeModel(input.userId, modelKey)
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  const reasoningEffort = await resolveReasoningEffort({
    userId: input.userId,
    modelKey: selection.modelKey,
    purpose: 'utility',
  })

  const prompt = buildAiPrompt({
    promptId: AI_PROMPT_IDS.PROJECT_AGENT_CONVERSATION_SUMMARY,
    locale: input.locale,
    variables: {
      previous_summary: input.previous?.summaryText ?? '',
      new_transcript: transcript,
    },
  })

  const generated = await generateText({
    model: createAiLanguageModel({
      providerKey: getProviderKey(selection.provider),
      selection,
      providerConfig,
      executionMode: 'sync',
      reasoning: false,
      reasoningEffort,
    }),
    prompt,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  })

  const summaryText = generated.text.trim()
  if (!summaryText) return input.previous

  return projectAgentConversationSummarySchema.parse({
    version: PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION,
    summarizedThroughMessageId: watermark.id,
    summarizedMessageCount: (input.previous?.summarizedMessageCount ?? 0) + input.newlySummarized.length,
    summaryText,
  } satisfies ProjectAgentConversationSummary)
}
