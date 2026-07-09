import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderSoundEffectExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { RETRY_POLICY, fetchWithRetry } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { ELEVENLABS_SOUND_EFFECT_MODEL_ID } from './models'

type ElevenLabsSoundEffectOptions = NonNullable<AiProviderSoundEffectExecutionContext['options']>

const ELEVENLABS_SOUND_GENERATION_URL = 'https://api.elevenlabs.io/v1/sound-generation'
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readDurationSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 30) {
    throw new Error('ELEVENLABS_SOUND_EFFECT_DURATION_SECONDS_INVALID')
  }
  return value
}

function readPromptInfluence(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('ELEVENLABS_SOUND_EFFECT_PROMPT_INFLUENCE_INVALID')
  }
  return value
}

function readLoop(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error('ELEVENLABS_SOUND_EFFECT_LOOP_INVALID')
  return value
}

function resolveOutputFormat(value: unknown): string {
  const outputFormat = readTrimmedString(value)
  return outputFormat || DEFAULT_OUTPUT_FORMAT
}

function buildRequestUrl(outputFormat: string, baseUrl?: string): string {
  const endpoint = baseUrl?.trim()
    ? `${baseUrl.trim().replace(/\/+$/, '')}/v1/sound-generation`
    : ELEVENLABS_SOUND_GENERATION_URL
  const url = new URL(endpoint)
  url.searchParams.set('output_format', outputFormat)
  return url.toString()
}

function mimeTypeFromOutputFormat(outputFormat: string): string {
  if (outputFormat.startsWith('pcm_')) return 'audio/wav'
  if (outputFormat.startsWith('ulaw_')) return 'audio/basic'
  return 'audio/mpeg'
}

function buildRequestBody(prompt: string, modelId: string, options: ElevenLabsSoundEffectOptions): Record<string, unknown> {
  const durationSeconds = readDurationSeconds(options.durationSeconds)
  const promptInfluence = readPromptInfluence(options.promptInfluence)
  const loop = readLoop(options.loop)
  return {
    text: prompt,
    model_id: modelId,
    ...(typeof loop === 'boolean' ? { loop } : {}),
    ...(typeof durationSeconds === 'number' ? { duration_seconds: durationSeconds } : {}),
    ...(typeof promptInfluence === 'number' ? { prompt_influence: promptInfluence } : {}),
  }
}

export async function executeElevenLabsSoundEffectGeneration(
  input: AiProviderSoundEffectExecutionContext,
): Promise<GenerateResult> {
  const options = input.options ?? {}
  const modelId = requireSelectedModelId(input.selection, 'elevenlabs:soundEffect')
  if (modelId !== ELEVENLABS_SOUND_EFFECT_MODEL_ID) {
    throw new Error(`ELEVENLABS_SOUND_EFFECT_MODEL_UNSUPPORTED:${modelId}`)
  }
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('ELEVENLABS_SOUND_EFFECT_PROMPT_REQUIRED')

  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  const outputFormat = resolveOutputFormat(options.outputFormat)
  const response = await fetchWithRetry(buildRequestUrl(outputFormat, baseUrl), {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(buildRequestBody(prompt, modelId, options)),
    cache: 'no-store',
    timeoutMs: 120_000,
    policy: RETRY_POLICY.mediaFetch,
    scope: `elevenlabs:sound-effect:${modelId}`,
    fetchFn: fetchWithProviderProxy,
  })

  const mimeType = response.headers.get('content-type') || mimeTypeFromOutputFormat(outputFormat)
  const audioBase64 = Buffer.from(await response.arrayBuffer()).toString('base64')
  if (!audioBase64) throw new Error('ELEVENLABS_SOUND_EFFECT_EMPTY_RESPONSE')
  return {
    success: true,
    audioBase64,
    audioMimeType: mimeType,
    audioUrl: `data:${mimeType};base64,${audioBase64}`,
    metadata: {
      model: modelId,
      outputFormat,
      characterCost: response.headers.get('character-cost') || null,
    },
  }
}
