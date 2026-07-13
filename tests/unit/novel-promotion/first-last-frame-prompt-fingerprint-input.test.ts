import { describe, expect, it } from 'vitest'

describe('first/last-frame prompt fingerprint input', () => {
  it('projects media identity and every server prompt context field canonically', async () => {
    const fingerprint = await import(
      '@/lib/novel-promotion/first-last-frame-prompt-fingerprint'
    ).catch(() => null)

    expect(fingerprint).not.toBeNull()
    if (!fingerprint) return
    const input = fingerprint.buildFirstLastFramePromptFingerprintInput({
      firstPanel: {
        id: 'panel-1',
        imageUrl: 'https://signed.example/one?token=secret',
        imageMedia: { publicId: 'public-1', storageKey: 'one.png', sha256: 'sha-1' },
        description: 'description',
        imagePrompt: 'image prompt',
        videoPrompt: 'video prompt',
        shotType: 'wide',
        cameraMove: 'pan',
        location: 'room',
        characters: '["A"]',
        props: 'book',
        srtSegment: 'dialogue',
        sceneType: 'interior',
        videoDurationBinding: JSON.stringify({ targetDurationSeconds: 8 }),
      },
      lastPanel: {
        id: 'panel-2',
        imageMedia: { publicId: 'public-2', storageKey: 'two.png', sha256: 'sha-2' },
      },
    })

    expect(input.first.image).toEqual({ publicId: 'public-1', storageKey: 'one.png', sha256: 'sha-1' })
    expect(input.first.context).toEqual({
      description: 'description',
      imagePrompt: 'image prompt',
      videoPrompt: 'video prompt',
      shotType: 'wide',
      cameraMove: 'pan',
      location: 'room',
      characters: '["A"]',
      props: 'book',
      srtSegment: 'dialogue',
      sceneType: 'interior',
    })
    expect(input).not.toHaveProperty('durationSeconds')
    expect(input).not.toHaveProperty('durationSource')
    expect(input).not.toHaveProperty('smartDurationAlgorithmVersion')
    expect(fingerprint.buildFirstLastFramePromptFingerprintInput({
      firstPanel: {
        id: 'panel-1',
        imageMedia: { publicId: 'public-1', storageKey: 'one.png', sha256: 'sha-1' },
        description: 'description',
        imagePrompt: 'image prompt',
        videoPrompt: 'video prompt',
        shotType: 'wide',
        cameraMove: 'pan',
        location: 'room',
        characters: '["A"]',
        props: 'book',
        srtSegment: 'dialogue',
        sceneType: 'interior',
        videoDurationBinding: JSON.stringify({
          targetDurationSeconds: 12,
          durationSource: 'manual',
          recommendedDurationSeconds: 8,
          recommendationFingerprint: 'smart-fp',
        }),
      },
      lastPanel: {
        id: 'panel-2',
        imageMedia: { publicId: 'public-2', storageKey: 'two.png', sha256: 'sha-2' },
      },
    })).toEqual(input)
  })
})
