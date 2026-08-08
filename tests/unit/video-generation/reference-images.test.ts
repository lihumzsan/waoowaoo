import { describe, expect, it } from 'vitest'
import { resolveProviderVideoReferencePayload } from '@/lib/video-generation/reference-images'

describe('explicit video reference transport contract', () => {
  it('keeps one ordinary reference image in reference mode', () => {
    expect(resolveProviderVideoReferencePayload({
      referenceImages: [{ url: 'https://example.com/identity.png', role: 'reference_image' }],
    })).toEqual({
      imageUrl: '',
      options: { referenceImages: ['https://example.com/identity.png'] },
    })
  })

  it('maps only explicit frame roles to frame transport fields', () => {
    expect(resolveProviderVideoReferencePayload({
      referenceImages: [{ url: 'https://example.com/start.png', role: 'first_frame' }],
    })).toEqual({ imageUrl: 'https://example.com/start.png', options: {} })

    expect(resolveProviderVideoReferencePayload({
      referenceImages: [
        { url: 'https://example.com/start.png', role: 'first_frame', order: 1 },
        { url: 'https://example.com/end.png', role: 'last_frame', order: 2 },
      ],
    })).toEqual({
      imageUrl: 'https://example.com/start.png',
      options: { lastFrameImageUrl: 'https://example.com/end.png' },
    })
  })

  it('rejects mixed frame and reference modes', () => {
    expect(() => resolveProviderVideoReferencePayload({
      referenceImages: [
        { url: 'https://example.com/start.png', role: 'first_frame' },
        { url: 'https://example.com/identity.png', role: 'reference_image' },
      ],
    })).toThrow('VIDEO_REFERENCE_MODE_CONFLICT')
  })
})
