import { afterEach, describe, expect, it } from 'vitest'
import {
  getPlatformCapabilityDefaults,
  getPlatformMusicGenerationOptions,
  getPlatformRuntimePlan,
  getPlatformVideoGenerationOptions,
} from '@/lib/platform-runtime/presets'

const ENV_KEYS = [
  'PLATFORM_IMAGE_RESOLUTION',
  'PLATFORM_IMAGE_QUALITY',
  'PLATFORM_VIDEO_RESOLUTION',
  'PLATFORM_VIDEO_GENERATE_AUDIO',
  'PLATFORM_MUSIC_DURATION_SECONDS',
  'PLATFORM_MUSIC_OUTPUT_FORMAT',
] as const

const ORIGINAL_ENV: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
for (const key of ENV_KEYS) {
  const value = process.env[key]
  if (value !== undefined) ORIGINAL_ENV[key] = value
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('platform runtime presets', () => {
  afterEach(() => restoreEnv())

  it('uses platform-owned video defaults without treating aspect ratio as a model option', () => {
    delete process.env.PLATFORM_VIDEO_RESOLUTION
    delete process.env.PLATFORM_VIDEO_GENERATE_AUDIO

    expect(getPlatformVideoGenerationOptions()).toEqual({
      resolution: '720p',
      generateAudio: false,
    })
    expect(getPlatformRuntimePlan('video')).toMatchObject({
      modelKey: 'ark::doubao-seedance-2-0-260128',
      generationOptions: {
        resolution: '720p',
        generateAudio: false,
      },
    })
  })

  it('reads explicit platform image, video, and music runtime options', () => {
    process.env.PLATFORM_IMAGE_RESOLUTION = '1024x1024'
    process.env.PLATFORM_IMAGE_QUALITY = 'high'
    process.env.PLATFORM_VIDEO_RESOLUTION = '480p'
    process.env.PLATFORM_VIDEO_GENERATE_AUDIO = 'true'
    process.env.PLATFORM_MUSIC_DURATION_SECONDS = '90'
    process.env.PLATFORM_MUSIC_OUTPUT_FORMAT = 'wav'

    expect(getPlatformCapabilityDefaults()).toMatchObject({
      'fal::banana-2': {
        resolution: '1024x1024',
        quality: 'high',
      },
      'ark::doubao-seedance-2-0-260128': {
        resolution: '480p',
        generateAudio: true,
      },
    })
    expect(getPlatformMusicGenerationOptions()).toEqual({
      durationSeconds: 90,
      outputFormat: 'wav',
    })
  })

  it('fails explicitly for invalid platform runtime environment values', () => {
    process.env.PLATFORM_VIDEO_GENERATE_AUDIO = 'maybe'
    expect(() => getPlatformVideoGenerationOptions()).toThrow('PLATFORM_RUNTIME_BOOLEAN_INVALID')

    process.env.PLATFORM_VIDEO_GENERATE_AUDIO = 'false'
    process.env.PLATFORM_MUSIC_DURATION_SECONDS = '0'
    expect(() => getPlatformMusicGenerationOptions()).toThrow('PLATFORM_RUNTIME_POSITIVE_INTEGER_INVALID')

    process.env.PLATFORM_MUSIC_DURATION_SECONDS = '60'
    process.env.PLATFORM_MUSIC_OUTPUT_FORMAT = 'flac'
    expect(() => getPlatformMusicGenerationOptions()).toThrow('PLATFORM_RUNTIME_MUSIC_OUTPUT_FORMAT_INVALID')
  })
})
