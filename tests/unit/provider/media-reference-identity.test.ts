import { describe, expect, it } from 'vitest'
import { createMediaProviderRequestIdentity } from '@/lib/ai-exec/media-references'

function videoRequest(signature: string) {
  return {
    modality: 'video',
    prompt: 'same prompt',
    imageUrl: `https://media.example.com/first.png?X-Amz-Signature=${signature}#transport`,
    options: {
      durationSeconds: 5,
      referenceImages: [
        `https://media.example.com/reference.png?X-Amz-Signature=${signature}`,
      ],
      referenceAudios: [
        `https://media.example.com/voice.wav?X-Amz-Signature=${signature}`,
      ],
      lastFrameImageUrl: `https://media.example.com/last.png?X-Amz-Signature=${signature}`,
    },
  } as const
}

describe('media provider durable request identity', () => {
  it('ignores temporary URL credentials without changing the wire request', () => {
    const firstWireRequest = videoRequest('first')
    const secondWireRequest = videoRequest('second')
    const firstSnapshot = structuredClone(firstWireRequest)

    expect(createMediaProviderRequestIdentity(firstWireRequest)).toEqual(
      createMediaProviderRequestIdentity(secondWireRequest),
    )
    expect(firstWireRequest).toEqual(firstSnapshot)
  })

  it('keeps object paths, reference order, and real options identity-bearing', () => {
    const base = videoRequest('first')
    const differentObject = {
      ...videoRequest('second'),
      imageUrl: 'https://media.example.com/other.png?X-Amz-Signature=second',
    }
    const differentOption = {
      ...videoRequest('second'),
      options: { ...videoRequest('second').options, durationSeconds: 10 },
    }
    const reversedReferences = {
      ...base,
      options: {
        ...base.options,
        referenceImages: [
          'https://media.example.com/second.png?token=1',
          'https://media.example.com/reference.png?token=2',
        ],
      },
    }
    const oppositeOrder = {
      ...reversedReferences,
      options: {
        ...reversedReferences.options,
        referenceImages: [...reversedReferences.options.referenceImages].reverse(),
      },
    }

    expect(createMediaProviderRequestIdentity(base)).not.toEqual(
      createMediaProviderRequestIdentity(differentObject),
    )
    expect(createMediaProviderRequestIdentity(base)).not.toEqual(
      createMediaProviderRequestIdentity(differentOption),
    )
    expect(createMediaProviderRequestIdentity(reversedReferences)).not.toEqual(
      createMediaProviderRequestIdentity(oppositeOrder),
    )
  })

  it('normalizes the signed video reference used by music generation', () => {
    const first = createMediaProviderRequestIdentity({
      modality: 'music',
      options: {
        referenceVideoUrl: 'https://media.example.com/final.mp4?X-Amz-Expires=60&token=one',
      },
    })
    const second = createMediaProviderRequestIdentity({
      modality: 'music',
      options: {
        referenceVideoUrl: 'https://media.example.com/final.mp4?X-Amz-Expires=120&token=two',
      },
    })

    expect(first).toEqual(second)
  })
})
