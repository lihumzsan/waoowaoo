import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { getUserModelConfig } from '@/lib/config-service'

/**
 * Model selection for short mechanical LLM work — conversation summarisation
 * and future equivalents. These calls are frequent, low-value and latency
 * sensitive, so running them on the Primary Agent model is pure waste.
 *
 * Resolution is a single chain with no guessing:
 *   1. `PLATFORM_DEFAULT_UTILITY_MODEL` when the operator points utility work
 *      at a dedicated cheap model.
 *   2. Otherwise the already-resolved analysis model, which itself honours
 *      project override, user preference and platform default.
 *
 * The env value is validated, never passed through raw: an unparseable key
 * fails here rather than reaching a provider as an unknown model id.
 */
export const PLATFORM_DEFAULT_UTILITY_MODEL_ENV = 'PLATFORM_DEFAULT_UTILITY_MODEL'

function readPlatformUtilityModelKey(): string | null {
  const raw = process.env[PLATFORM_DEFAULT_UTILITY_MODEL_ENV]?.trim()
  if (!raw) return null
  const parsed = parseModelKeyStrict(raw)
  if (!parsed) {
    throw new Error(`UTILITY_MODEL_KEY_INVALID:${PLATFORM_DEFAULT_UTILITY_MODEL_ENV}`)
  }
  return parsed.modelKey
}

export async function resolveUtilityModelKey(userId: string): Promise<string> {
  const platformOverride = readPlatformUtilityModelKey()
  if (platformOverride) return platformOverride

  const userConfig = await getUserModelConfig(userId)
  const analysisModelKey = userConfig.analysisModel
  if (!analysisModelKey) {
    throw new Error('UTILITY_MODEL_NOT_CONFIGURED')
  }
  const parsed = parseModelKeyStrict(analysisModelKey)
  if (!parsed) {
    throw new Error(`UTILITY_MODEL_KEY_INVALID:${analysisModelKey}`)
  }
  return parsed.modelKey
}
