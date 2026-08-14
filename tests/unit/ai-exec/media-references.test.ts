import { describe, expect, it } from 'vitest'
import {
  assertImageMediaReferencesUseAbsoluteHttpUrls,
  assertVideoMediaReferencesUseAbsoluteHttpUrls,
} from '@/lib/ai-exec/media-references'

describe('media-reference transport validation', () => {
  it('accepts a local MinIO HTTP reference image', () => {
    expect(() => assertImageMediaReferencesUseAbsoluteHttpUrls({
      referenceImages: ['http://127.0.0.1:19000/waoowaoo/private.png?X-Amz-Signature=test'],
    })).not.toThrow()
  })

  it.each([
    '/waoowaoo/private.png',
    'data:image/png;base64,AAAA',
    'file:///C:/private.png',
    'ftp://127.0.0.1/private.png',
    'http://user:password@127.0.0.1:19000/waoowaoo/private.png',
  ])('rejects an unsafe image reference: %s', (referenceImage) => {
    expect(() => assertImageMediaReferencesUseAbsoluteHttpUrls({
      referenceImages: [referenceImage],
    })).toThrow(/PROVIDER_MEDIA_REFERENCE_(SCHEME_UNSUPPORTED|CREDENTIALS_FORBIDDEN|INVALID):referenceImages\[0\]/)
  })

  it('applies the same rule to video start and last-frame inputs', () => {
    expect(() => assertVideoMediaReferencesUseAbsoluteHttpUrls({
      imageUrl: 'http://127.0.0.1:19000/waoowaoo/first.png',
      options: { lastFrameImageUrl: 'https://media.example.test/last.png' },
    })).not.toThrow()
  })
})
