import { describe, expect, it } from 'vitest'
import {
  chatMessageHasCacheControl,
  flattenChatMessageContent,
  normalizeChatMessageContentParts,
  type ChatMessage,
} from '@/lib/ai-registry/message-content'
import {
  flattenProviderMessageContent,
  normalizeProviderContentParts,
  providerMessageHasCacheControl,
  type ProviderChatMessage,
} from '@/lib/ai-providers/shared/llm-support'

describe('provider message content contract', () => {
  it('keeps provider helpers backed by the shared ai-registry message contract', () => {
    const message: ProviderChatMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'cacheable prompt',
          cacheControl: { type: 'ephemeral', ttl: '1h' },
        },
        { type: 'text', text: ' plain tail' },
      ],
    }
    const registryMessage: ChatMessage = message

    expect(flattenChatMessageContent(registryMessage.content)).toBe('cacheable prompt plain tail')
    expect(flattenProviderMessageContent(message.content)).toBe('cacheable prompt plain tail')
    expect(normalizeChatMessageContentParts('plain prompt')).toEqual([{ type: 'text', text: 'plain prompt' }])
    expect(normalizeProviderContentParts('plain prompt')).toEqual([{ type: 'text', text: 'plain prompt' }])
    expect(chatMessageHasCacheControl(registryMessage)).toBe(true)
    expect(providerMessageHasCacheControl(message)).toBe(true)
  })
})
