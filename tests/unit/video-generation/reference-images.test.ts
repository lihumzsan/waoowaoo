import { describe, expect, it } from 'vitest'
import {
  normalizeVideoReferenceImages,
  resolveProviderVideoReferencePayload,
} from '@/lib/video-generation/reference-images'

describe('video generation reference images', () => {
  it('normalizes ordered visual references and removes duplicate reference urls', () => {
    expect(normalizeVideoReferenceImages([
      { url: ' https://example.com/b.png ', order: 2, source: 'asset' },
      { url: 'https://example.com/a.png', order: 1, source: 'storyboard' },
      { url: 'https://example.com/a.png', order: 3, source: 'asset' },
    ])).toEqual([
      { url: 'https://example.com/a.png', role: 'reference', order: 1, source: 'storyboard' },
      { url: 'https://example.com/b.png', role: 'reference', order: 2, source: 'asset' },
    ])
  })

  it('resolves normal provider payload from unified references', () => {
    expect(resolveProviderVideoReferencePayload({
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1 },
        { url: 'https://example.com/location.png', role: 'reference', order: 2 },
      ],
    })).toEqual({
      imageUrl: 'https://example.com/hero.png',
      options: {
        referenceImages: ['https://example.com/hero.png', 'https://example.com/location.png'],
      },
    })
  })

  it('uses a single normal reference as provider imageUrl without referenceImages option', () => {
    expect(resolveProviderVideoReferencePayload({
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1 },
      ],
    })).toEqual({
      imageUrl: 'https://example.com/hero.png',
      options: {},
    })
  })

  it('resolves first-last provider payload from unified references', () => {
    expect(resolveProviderVideoReferencePayload({
      referenceImages: [
        { url: 'https://example.com/first.png', role: 'first_frame', order: 1 },
        { url: 'https://example.com/last.png', role: 'last_frame', order: 2 },
      ],
    })).toEqual({
      imageUrl: 'https://example.com/first.png',
      options: {
        lastFrameImageUrl: 'https://example.com/last.png',
      },
    })
  })

  it('rejects duplicate first-last roles explicitly', () => {
    expect(() => normalizeVideoReferenceImages([
      { url: 'https://example.com/first-a.png', role: 'first_frame' },
      { url: 'https://example.com/first-b.png', role: 'first_frame' },
    ])).toThrow('VIDEO_REFERENCE_FIRST_FRAME_DUPLICATE')
  })
})
