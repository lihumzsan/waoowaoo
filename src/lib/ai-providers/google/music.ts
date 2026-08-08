import { GoogleGenAI } from '@google/genai'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { withRetry } from '@/lib/retry'
import { withProviderProxyDispatcher } from '@/lib/http/outbound-proxy'
import { GOOGLE_PROVIDER_PROXY_TARGET } from '@/lib/ai-providers/google/proxy-target'
import { AppError } from '@/lib/errors/app-error'
import {
  captureGoogleSdkSubmission,
  googleSafetyTerminalError,
} from './submission'

interface GoogleMusicPart {
  inlineData?: {
    data?: string
    mimeType?: string
  }
  text?: string
}

interface GoogleMusicResponse {
  candidates?: Array<{
    content?: {
      parts?: GoogleMusicPart[]
    }
    finishReason?: string
  }>
}

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getFinishReason(response: GoogleMusicResponse): string | undefined {
  return response.candidates?.[0]?.finishReason
}

function isSafetyFinishReason(reason: string | undefined): reason is string {
  return reason === 'SAFETY'
    || reason === 'PROHIBITED_CONTENT'
    || reason === 'BLOCKLIST'
    || reason === 'RECITATION'
}

export function extractGoogleMusicResult(response: unknown): {
  audioBase64: string
  audioMimeType: string
  textMetadata: string
  finishReason?: string
} {
  const safe = response && typeof response === 'object' ? response as GoogleMusicResponse : {}
  const parts = safe.candidates?.[0]?.content?.parts || []
  const textParts: string[] = []
  let audioBase64 = ''
  let audioMimeType = ''

  for (const part of parts) {
    const text = trim(part.text)
    if (text) textParts.push(text)

    const mimeType = trim(part.inlineData?.mimeType)
    const data = trim(part.inlineData?.data)
    if (!audioBase64 && data && mimeType.startsWith('audio/')) {
      audioBase64 = data
      audioMimeType = mimeType
    }
  }

  if (audioBase64) {
    return {
      audioBase64,
      audioMimeType,
      textMetadata: textParts.join('\n\n'),
      finishReason: getFinishReason(safe),
    }
  }

  const finishReason = getFinishReason(safe)
  if (isSafetyFinishReason(finishReason)) {
    throw googleSafetyTerminalError(finishReason)
  }
  throw new AppError('EMPTY_RESPONSE', 'Google returned no audio', { provider: 'google' })
}

export async function executeGoogleMusicGeneration(input: AiProviderMusicExecutionContext): Promise<GenerateResult> {
  const { apiKey } = await getProviderConfig(input.userId, input.selection.provider)
  const ai = new GoogleGenAI({ apiKey })
  const modelId = requireSelectedModelId(input.selection, 'google:music')

  const response = await captureGoogleSdkSubmission(async () => await withRetry({
    operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
    scope: `google:music:generate:${modelId}`,
    run: async () => await withProviderProxyDispatcher(
      GOOGLE_PROVIDER_PROXY_TARGET,
      async () => await ai.models.generateContent({
        model: modelId,
        contents: [{ parts: [{ text: input.prompt }] }],
      }),
    ),
  }))

  const result = extractGoogleMusicResult(response)
  return {
    success: true,
    audioBase64: result.audioBase64,
    audioMimeType: result.audioMimeType,
    audioUrl: `data:${result.audioMimeType};base64,${result.audioBase64}`,
    metadata: {
      ...(result.textMetadata ? { text: result.textMetadata } : {}),
      ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      model: modelId,
    },
  }
}
