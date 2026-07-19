import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requestOpenRouterImage } from '@/lib/ai-providers/openrouter/image'
import type { OpenRouterImageOptions } from '@/lib/ai-providers/openrouter/image-options'
import {
  OPENROUTER_GPT_IMAGE_2_MODEL_ID,
  resolveOpenRouterOptionSchema,
} from '@/lib/ai-providers/openrouter/models'
import { normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const PNG_1X1_DATA_URL = `data:image/png;base64,${PNG_1X1_BASE64}`

function normalizeImageOptions(options: Record<string, unknown>): OpenRouterImageOptions {
  return normalizeAiOptions({
    schema: resolveOpenRouterOptionSchema('image', OPENROUTER_GPT_IMAGE_2_MODEL_ID),
    options,
    context: 'openrouter-image-contract',
  }) as OpenRouterImageOptions
}

describe('provider contract - OpenRouter image', () => {
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  beforeEach(async () => {
    server = await startScenarioServer()
  })

  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('normalizes model defaults and conflicts before SDK execution', () => {
    expect(normalizeImageOptions({ aspectRatio: '1:1' })).toMatchObject({
      aspectRatio: '1:1',
      resolution: '1K',
      quality: 'high',
      outputFormat: 'png',
      referenceImages: [],
      imageSize: { width: 1080, height: 1080 },
    })
    expect(() => normalizeImageOptions({
      aspectRatio: '1:1',
      size: '1K',
      resolution: '2K',
    })).toThrow('size_and_resolution_must_match')
    expect(() => normalizeImageOptions({
      aspectRatio: '1:1',
      outputCompression: 50,
    })).toThrow('outputCompression_requires_jpeg_or_webp')
    expect(() => normalizeImageOptions({
      aspectRatio: '1:1',
      keepOriginalAspectRatio: true,
    })).toThrow('AI_OPTION_UNSUPPORTED')
  })

  it('submits the dedicated image API payload and projects the buffered image response', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/images',
      mode: 'success',
      submitResponse: {
        status: 200,
        body: {
          data: [{ b64_json: PNG_1X1_BASE64, media_type: 'image/webp' }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 4075,
            total_tokens: 4175,
            cost: 0.165,
          },
        },
      },
    })

    const result = await requestOpenRouterImage({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-image-key',
      modelId: 'openai/gpt-image-2',
      prompt: 'paint this as a watercolor scene',
      options: normalizeImageOptions({
        referenceImages: [PNG_1X1_DATA_URL],
        aspectRatio: '9:16',
        resolution: '1K',
        quality: 'high',
        outputFormat: 'webp',
        background: 'opaque',
        outputCompression: 60,
        moderation: 'low',
      }),
    })

    expect(result).toEqual({
      success: true,
      imageBase64: PNG_1X1_BASE64,
      imageUrl: `data:image/png;base64,${PNG_1X1_BASE64}`,
      metadata: {
        openRouterUsage: { inputTokens: 100, outputTokens: 4075, totalTokens: 4175 },
      },
    })
    const requests = server!.getRequests('POST', '/openrouter/images')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers.authorization).toBe('Bearer openrouter-image-key')
    expect(requests[0]?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(requests[0]?.bodyText || '{}')).toEqual({
      model: 'openai/gpt-image-2',
      prompt: 'paint this as a watercolor scene',
      n: 1,
      size: '1080x1920',
      quality: 'high',
      output_format: 'webp',
      input_references: [{
        type: 'image_url',
        image_url: { url: PNG_1X1_DATA_URL },
      }],
      background: 'opaque',
      output_compression: 60,
      provider: {
        only: ['openai'],
        allow_fallbacks: false,
        options: { openai: { moderation: 'low' } },
      },
    })
  })

  it('does not retry an uncertain image POST', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/images',
      mode: 'retryable_error_then_success',
      submitResponse: { status: 503, body: { error: 'upstream unavailable' } },
      pollSequence: [{
        status: 200,
        body: { data: [{ b64_json: PNG_1X1_BASE64, media_type: 'image/png' }] },
      }],
    })

    await expect(requestOpenRouterImage({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-image-key',
      modelId: 'openai/gpt-image-2',
      prompt: 'generate once',
      options: normalizeImageOptions({ aspectRatio: '1:1', resolution: '1K', quality: 'low' }),
    })).rejects.toMatchObject({ statusCode: 503 })

    expect(server!.getRequests('POST', '/openrouter/images')).toHaveLength(1)
  })

  it('fails explicitly when a successful response has no image bytes', async () => {
    server!.defineScenario({
      method: 'POST',
      path: '/openrouter/images',
      mode: 'malformed_response',
      submitResponse: { status: 200, body: { data: [] } },
    })

    await expect(requestOpenRouterImage({
      baseUrl: `${server!.baseUrl}/openrouter`,
      apiKey: 'openrouter-image-key',
      modelId: 'openai/gpt-image-2',
      prompt: 'missing output',
      options: normalizeImageOptions({ aspectRatio: '1:1', resolution: '1K', quality: 'low' }),
    })).rejects.toThrow('OPENROUTER_IMAGE_RESPONSE_MISSING_IMAGE')
  })
})
