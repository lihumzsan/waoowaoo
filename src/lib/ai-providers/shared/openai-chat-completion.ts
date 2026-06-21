import OpenAI from 'openai'

export function buildOpenAIChatCompletion(
  modelId: string,
  content: unknown,
  usage?: {
    promptTokens?: number
    completionTokens?: number
    cachedInputTokens?: number
    cacheWriteTokens?: number
  },
): OpenAI.Chat.Completions.ChatCompletion {
  const messageContent: OpenAI.Chat.Completions.ChatCompletionMessage['content'] =
    typeof content === 'string' || Array.isArray(content)
      ? (content as OpenAI.Chat.Completions.ChatCompletionMessage['content'])
      : String(content ?? '')
  const promptTokens = usage?.promptTokens ?? 0
  const completionTokens = usage?.completionTokens ?? 0
  return {
    id: `chatcmpl_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: messageContent },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      ...(typeof usage?.cachedInputTokens === 'number' || typeof usage?.cacheWriteTokens === 'number'
        ? {
          prompt_tokens_details: {
            cached_tokens: usage?.cachedInputTokens ?? 0,
            cache_write_tokens: usage?.cacheWriteTokens ?? 0,
          },
        }
        : {}),
    },
  } as OpenAI.Chat.Completions.ChatCompletion
}
