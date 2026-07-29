import type { AgentInputItem } from '@openai/agents'
import { generateText } from 'ai'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { createAiLanguageModel } from '@/lib/ai-exec/language-model'
import { logLlmRawInput, logLlmRawOutput, resolveLlmRuntimeModel } from '@/lib/ai-exec/llm-runtime'
import { projectAiSdkLanguageModelResult } from '@/lib/ai-exec/llm/result-projector'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import { resolveUtilityModelKey } from '@/lib/ai-exec/utility-model'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import {
  PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION,
  buildProjectAgentSummaryTranscript,
  projectAgentConversationSummarySchema,
  type ProjectAgentConversationSummary,
} from './summary'

export async function extendProjectAgentConversationSummary(input: {
  userId: string
  previous: ProjectAgentConversationSummary | null
  newlySummarized: readonly AgentInputItem[]
  signal?: AbortSignal
}): Promise<ProjectAgentConversationSummary | null> {
  if (input.newlySummarized.length === 0) return input.previous
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
    variables: {
      previous_summary: input.previous?.summaryText ?? '',
      new_transcript: transcript,
    },
  })

  const providerKey = getProviderKey(selection.provider)
  const summaryAction = 'assistant.context.summary'
  // Shares the llm.raw.* summary log shape with every other LLM call point;
  // no message or output content is logged.
  logLlmRawInput({
    userId: input.userId,
    provider: providerKey,
    modelId: selection.modelId,
    modelKey: selection.modelKey,
    stream: false,
    reasoning: false,
    reasoningEffort,
    action: summaryAction,
    messages: [{ role: 'user', content: prompt }],
  })
  const generated = await generateText({
    model: createAiLanguageModel({
      providerKey,
      selection,
      providerConfig,
      executionMode: 'sync',
      reasoning: false,
      reasoningEffort,
    }),
    prompt,
    // Matches the ai-exec sdk-runner: transport failures surface immediately
    // instead of being retried silently by the AI SDK.
    maxRetries: 0,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  })
  const projected = projectAiSdkLanguageModelResult({
    provider: providerKey,
    modelId: selection.modelId,
    result: generated,
  })
  logLlmRawOutput({
    userId: input.userId,
    provider: providerKey,
    modelId: selection.modelId,
    modelKey: selection.modelKey,
    stream: false,
    action: summaryAction,
    text: projected.text,
    reasoning: projected.reasoning,
    termination: projected.termination,
    usage: projected.usage,
  })

  const summaryText = generated.text.trim()
  if (!summaryText) return input.previous
  return projectAgentConversationSummarySchema.parse({
    version: PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION,
    summarizedItemCount: (input.previous?.summarizedItemCount ?? 0) + input.newlySummarized.length,
    summaryText,
  } satisfies ProjectAgentConversationSummary)
}
