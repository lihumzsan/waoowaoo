import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'

export async function assertVisionModelSupported(input: {
  readonly userId: string
  readonly model: string
  readonly errorCode: string
}): Promise<void> {
  const modelKey = input.model.trim()
  if (!modelKey) {
    throw new Error(`${input.errorCode}:MODEL_REQUIRED`)
  }

  const selection = await resolveModelSelection(input.userId, modelKey, 'llm')
  const adapter = resolveAiProviderAdapter(selection.provider)
  if (!adapter.completeVision) {
    throw new Error(`${input.errorCode}:${selection.modelKey}`)
  }
}
