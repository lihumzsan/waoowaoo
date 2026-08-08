import type { LanguageModel } from 'ai'
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import type { CodexChatMessage } from './client'
import { runCodexTextCompletion } from './client'

function textFromPromptMessage(message: LanguageModelV3CallOptions['prompt'][number]): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function toCodexMessages(prompt: LanguageModelV3CallOptions['prompt']): CodexChatMessage[] {
  return prompt.flatMap((message) => {
    const content = textFromPromptMessage(message)
    if (!content) return []
    return [{ role: message.role === 'tool' ? 'user' : message.role, content }]
  })
}

function usage() {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  }
}

function buildCodexLanguageModel(input: AiProviderLanguageModelContext): LanguageModelV3 {
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'codex',
    modelId: input.selection.modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const result = await runCodexTextCompletion({
        model: input.selection.modelId,
        messages: toCodexMessages(options.prompt),
      })
      return {
        content: [{ type: 'text', text: result.text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(),
        warnings: [],
      }
    },
    async doStream(options) {
      const result = await runCodexTextCompletion({
        model: input.selection.modelId,
        messages: toCodexMessages(options.prompt),
      })
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 'codex-text' })
          controller.enqueue({ type: 'text-delta', id: 'codex-text', delta: result.text })
          controller.enqueue({ type: 'text-end', id: 'codex-text' })
          controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: usage() })
          controller.close()
        },
      })
      return { stream }
    },
  }
  return model
}

export function createCodexLanguageModel(input: AiProviderLanguageModelContext): LanguageModel {
  if (input.protocol !== 'codex-cli') {
    throw new Error(`LLM_PROTOCOL_PROVIDER_MISMATCH:codex:${input.protocol}`)
  }
  return buildCodexLanguageModel(input)
}
