import { describe, expect, it } from 'vitest'
import {
  buildImageRuntimeGenerationOptions,
  readImageRuntimeGenerationOptions,
  requireImageRuntimeAspectRatio,
  resolveImageSizeFromGenerationOptions,
} from '@/lib/image-generation/runtime-options'

describe('image-generation/runtime-options', () => {
  it('builds runtime generation options from capability defaults and business aspect ratio', () => {
    const options = buildImageRuntimeGenerationOptions({
      capabilityOptions: {
        resolution: '1K',
        quality: 'medium',
        count: 2,
      },
      aspectRatio: '16:9',
    })

    expect(options).toEqual({
      resolution: '1K',
      quality: 'medium',
      count: 2,
      aspectRatio: '16:9',
    })
  })

  it('reads only supported image runtime option fields', () => {
    expect(readImageRuntimeGenerationOptions({
      aspectRatio: '16:9',
      resolution: '1K',
      quality: 'high',
      size: '1920x1080',
      count: 3,
    })).toEqual({
      aspectRatio: '16:9',
      resolution: '1K',
      quality: 'high',
      size: '1920x1080',
    })
  })

  it('requires an explicit image aspect ratio at worker runtime', () => {
    expect(requireImageRuntimeAspectRatio({ aspectRatio: '3:2' }, 'asset_image')).toBe('3:2')
    expect(() => requireImageRuntimeAspectRatio({ resolution: '1K' }, 'asset_image'))
      .toThrow('IMAGE_RUNTIME_ASPECT_RATIO_REQUIRED:asset_image')
  })

  it('derives provider billing image sizes from resolution and aspect ratio', () => {
    expect(resolveImageSizeFromGenerationOptions({
      resolution: '1K',
      aspectRatio: '16:9',
    })).toBe('1920x1080')
    expect(resolveImageSizeFromGenerationOptions({
      resolution: '2K',
      aspectRatio: '16:9',
    })).toBe('2560x1440')
  })
})
