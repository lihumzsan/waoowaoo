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
import { projectAiLlmUsage, type LlmUsageFact } from '@/lib/billing/llm-usage'
import {
  PROJECT_AGENT_CONTEXT_CHECKPOINT_VERSION,
  buildProjectAgentCheckpointTranscript,
  projectAgentContextCheckpointSchema,
  type ProjectAgentContextCheckpoint,
} from './checkpoint'
import { PROJECT_AGENT_RESERVED_OUTPUT_TOKENS } from './budget'

export async function generateProjectAgentContextCheckpoint(input: {
  userId: string
  items: readonly AgentInputItem[]
  signal?: AbortSignal
}): Promise<{
  checkpoint: ProjectAgentContextCheckpoint
  usage: LlmUsageFact
}> {
  if (input.items.length === 0) {
    throw new Error('PROJECT_AGENT_CONTEXT_CHECKPOINT_INPUT_EMPTY')
  }
  const transcript = buildProjectAgentCheckpointTranscript(input.items)

  const modelKey = await resolveUtilityModelKey(input.userId)
  const selection = await resolveLlmRuntimeModel(input.userId, modelKey)
  const providerConfig = await getProviderConfig(input.userId, selection.provider)
  const reasoningEffort = await resolveReasoningEffort({
    userId: input.userId,
    modelKey: selection.modelKey,
    purpose: 'utility',
  })

  const prompt = buildAiPrompt({
    promptId: AI_PROMPT_IDS.PROJECT_AGENT_CONTEXT_CHECKPOINT,
    variables: {
      transcript,
    },
  })

  const providerKey = getProviderKey(selection.provider)
  const checkpointAction = 'assistant.context.compress'
  // Shares the llm.raw.* log shape with every other LLM call point;
  // no message or output content is logged.
  logLlmRawInput({
    userId: input.userId,
    provider: providerKey,
    modelId: selection.modelId,
    modelKey: selection.modelKey,
    stream: false,
    reasoning: false,
    reasoningEffort,
    action: checkpointAction,
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
    maxOutputTokens: PROJECT_AGENT_RESERVED_OUTPUT_TOKENS,
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
    action: checkpointAction,
    text: projected.text,
    reasoning: projected.reasoning,
    termination: projected.termination,
    usage: projected.usage,
  })

  const checkpointText = generated.text.trim()
  if (!checkpointText) throw new Error('PROJECT_AGENT_CONTEXT_CHECKPOINT_EMPTY')
  return {
    checkpoint: projectAgentContextCheckpointSchema.parse({
      version: PROJECT_AGENT_CONTEXT_CHECKPOINT_VERSION,
      replacedItemCount: input.items.length,
      checkpointText,
    } satisfies ProjectAgentContextCheckpoint),
    usage: projectAiLlmUsage({
      phase: 'context_compaction',
      modelKey: selection.modelKey,
      usage: projected.usage,
    }),
  }
}
