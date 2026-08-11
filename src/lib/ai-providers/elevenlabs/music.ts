import { AppError } from '@/lib/errors/app-error'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { captureProviderHttpFailure, ProviderHttpError } from '@/lib/ai-providers/failure'
import {
  musicCompositionPlanSchema,
  toElevenLabsCompositionPlan,
} from '@/lib/music/composition-plan'
import { buildElevenLabsUrl } from './base-url'
import { ELEVENLABS_MUSIC_V2_MODEL_ID } from './models'

const ELEVENLABS_MUSIC_RESPONSE_MAX_BYTES = 64 * 1024 * 1024
const ELEVENLABS_MUSIC_OUTPUT_FORMAT = 'mp3_48000_192'

function rejectedSubmissionCode(status: number): UnifiedErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_INVALID'
  if (status === 402) return 'PROVIDER_BILLING_REQUIRED'
  return 'PROVIDER_SUBMISSION_REJECTED'
}

function providerMachineCode(error: ProviderHttpError): string | null {
  const payload = error.errorEnvelope
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return error.code
  const detail = Reflect.get(payload, 'detail')
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return error.code
  const status = Reflect.get(detail, 'status')
  return typeof status === 'string' && status.trim() ? status.trim().slice(0, 256) : error.code
}

async function throwElevenLabsHttpFailure(response: Response): Promise<never> {
  const error = await captureProviderHttpFailure({
    response,
    provider: 'elevenlabs',
    phase: 'submit',
  })
  if ([401, 402, 403, 422].includes(response.status)) {
    throw new ProviderSubmissionError(
      rejectedSubmissionCode(response.status),
      response.status === 422
        ? 'ElevenLabs rejected the music Composition Plan'
        : `ElevenLabs rejected the music request (HTTP ${String(response.status)})`,
      {
        disposition: 'rejected',
        provider: 'elevenlabs',
        details: {
          httpStatus: response.status,
          providerCode: providerMachineCode(error),
        },
        cause: error,
      },
    )
  }
  throw error
}

export async function executeElevenLabsMusicGeneration(
  input: AiProviderMusicExecutionContext,
): Promise<GenerateResult> {
  if (input.generation.kind !== 'composition_plan') {
    throw new AppError('INVALID_PARAMS', 'Eleven Music v2 requires a Composition Plan', {
      provider: 'elevenlabs',
    })
  }
  const compositionPlan = musicCompositionPlanSchema.parse(input.generation.compositionPlan)
  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  if (!apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'elevenlabs' })
  const modelId = requireSelectedModelId(input.selection, 'elevenlabs:music')
  if (modelId !== ELEVENLABS_MUSIC_V2_MODEL_ID) {
    throw new AppError('INVALID_PARAMS', `ElevenLabs music model is unsupported: ${modelId}`, {
      provider: 'elevenlabs',
    })
  }

  const response = await fetchWithProviderProxy(
    `${buildElevenLabsUrl('/v1/music', baseUrl)}?output_format=${ELEVENLABS_MUSIC_OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        model_id: ELEVENLABS_MUSIC_V2_MODEL_ID,
        composition_plan: toElevenLabsCompositionPlan(compositionPlan),
      }),
      cache: 'no-store',
    },
  )
  if (!response.ok) return await throwElevenLabsHttpFailure(response)

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || ''
  if (!contentType.startsWith('audio/')) {
    throw new Error(`ELEVENLABS_MUSIC_RESPONSE_CONTENT_TYPE_INVALID:${contentType || 'missing'}`)
  }
  const audio = await readResponseBufferWithLimit(
    response,
    ELEVENLABS_MUSIC_RESPONSE_MAX_BYTES,
    'ElevenLabs music response',
  )
  if (audio.byteLength === 0) throw new Error('ELEVENLABS_MUSIC_RESPONSE_EMPTY')
  const songId = response.headers.get('song-id')?.trim() || null
  return {
    success: true,
    audioBase64: audio.toString('base64'),
    audioMimeType: contentType,
    ...(songId ? { requestId: songId, metadata: { songId } } : {}),
  }
}
