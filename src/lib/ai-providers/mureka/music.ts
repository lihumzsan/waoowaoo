import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { RETRY_POLICY, fetchWithRetry } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { buildMurekaUrl } from './base-url'
import { MUREKA_9_MODEL_ID } from './models'

/** Official wire limit: soundtrack/instrumental prompts accept at most 1024 characters. */
const MUREKA_PROMPT_MAX_CHARS = 1024

type MurekaMusicOptions = NonNullable<AiProviderMusicExecutionContext['options']>

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEntityId(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function buildMurekaPrompt(prompt: string, options: MurekaMusicOptions): string {
  const lines = [prompt.trim()]
  const genre = readTrimmedString(options.genre)
  const mood = readTrimmedString(options.mood)
  if (genre) lines.push(`Genre: ${genre}`)
  if (mood) lines.push(`Mood: ${mood}`)
  if (options.vocalMode === 'instrumental') lines.push('Instrumental only. Do not include vocals or lyrics.')
  const composed = lines.join('\n')
  if (!composed.trim()) throw new Error('MUREKA_MUSIC_PROMPT_REQUIRED')
  if (composed.length > MUREKA_PROMPT_MAX_CHARS) {
    throw new Error(`MUREKA_MUSIC_PROMPT_TOO_LONG:${String(composed.length)}`)
  }
  return composed
}

async function postMurekaJson(input: {
  readonly path: string
  readonly apiKey: string
  readonly baseUrl?: string
  readonly payload: Record<string, unknown>
  readonly scope: string
}): Promise<unknown> {
  const response = await fetchWithRetry(buildMurekaUrl(input.path, input.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(input.payload),
    policy: RETRY_POLICY.providerSubmit,
    cache: 'no-store',
    scope: input.scope,
    fetchFn: fetchWithProviderProxy,
  })
  return await response.json() as unknown
}

async function uploadMurekaSoundtrackVideo(input: {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly videoUrl: string
}): Promise<string> {
  const form = new FormData()
  form.set('purpose', 'soundtrack')
  form.set('url', input.videoUrl)
  const response = await fetchWithRetry(buildMurekaUrl('/v1/files/upload', input.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: form,
    policy: RETRY_POLICY.providerSubmit,
    cache: 'no-store',
    scope: 'mureka:music:upload',
    fetchFn: fetchWithProviderProxy,
  })
  const data = await response.json() as { id?: unknown }
  const fileId = readEntityId(data.id)
  if (!fileId) throw new Error('MUREKA_UPLOAD_FILE_ID_MISSING')
  return fileId
}

export async function executeMurekaMusicGeneration(input: AiProviderMusicExecutionContext): Promise<GenerateResult> {
  const options = input.options ?? {}
  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  if (!apiKey) throw new Error('MUREKA_API_KEY_MISSING')
  const modelId = requireSelectedModelId(input.selection, 'mureka:music')
  if (modelId !== MUREKA_9_MODEL_ID) {
    throw new Error(`MUREKA_MUSIC_MODEL_UNSUPPORTED:${modelId}`)
  }

  const prompt = buildMurekaPrompt(input.prompt, options)
  const referenceVideoUrl = readTrimmedString(options.referenceVideoUrl)

  if (referenceVideoUrl) {
    const durationMs = typeof options.referenceVideoDurationMs === 'number' && Number.isInteger(options.referenceVideoDurationMs)
      ? options.referenceVideoDurationMs
      : typeof options.durationSeconds === 'number'
        ? Math.round(options.durationSeconds * 1000)
        : null
    if (!durationMs || durationMs <= 0) throw new Error('MUREKA_SOUNDTRACK_DURATION_REQUIRED')
    const videoId = await uploadMurekaSoundtrackVideo({ apiKey, baseUrl, videoUrl: referenceVideoUrl })
    const task = await postMurekaJson({
      path: '/v1/soundtrack/generate',
      apiKey,
      baseUrl,
      payload: {
        video_id: videoId,
        model: modelId,
        prompt,
        n: 1,
        audio_start: 0,
        audio_end: durationMs,
      },
      scope: 'mureka:music:soundtrack:submit',
    }) as { id?: unknown }
    const taskId = readEntityId(task.id)
    if (!taskId) throw new Error('MUREKA_SOUNDTRACK_TASK_ID_MISSING')
    return {
      success: true,
      async: true,
      requestId: taskId,
      endpoint: 'song',
      externalId: `MUREKA:MUSIC:song:${taskId}`,
    }
  }

  const task = await postMurekaJson({
    path: '/v1/instrumental/generate',
    apiKey,
    baseUrl,
    payload: {
      model: modelId,
      prompt,
      n: 1,
    },
    scope: 'mureka:music:instrumental:submit',
  }) as { id?: unknown }
  const taskId = readEntityId(task.id)
  if (!taskId) throw new Error('MUREKA_INSTRUMENTAL_TASK_ID_MISSING')
  return {
    success: true,
    async: true,
    requestId: taskId,
    endpoint: 'instrumental',
    externalId: `MUREKA:MUSIC:instrumental:${taskId}`,
  }
}
