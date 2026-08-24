import { describe, expect, it } from 'vitest'
import {
  VideoInputModeError,
  resolveVideoInputMode,
  type VideoInputReference,
} from '@/lib/video-generation/input-mode'

function expectModeError(
  references: readonly VideoInputReference[],
  code: VideoInputModeError['code'],
): void {
  try {
    resolveVideoInputMode(references)
  } catch (error) {
    expect(error).toBeInstanceOf(VideoInputModeError)
    expect((error as VideoInputModeError).code).toBe(code)
    return
  }
  throw new Error('Expected resolveVideoInputMode to reject the references')
}

describe('resolveVideoInputMode', () => {
  it('resolves no provider media references as text-to-video', () => {
    expect(resolveVideoInputMode([])).toEqual({
      mode: 'text_to_video',
      firstFrameCount: 0,
      lastFrameCount: 0,
      referenceImageCount: 0,
      referenceAudioCount: 0,
      referenceVideoCount: 0,
      usesLastFrame: false,
    })
  })

  it('keeps ordinary images in reference mode regardless of count', () => {
    expect(resolveVideoInputMode([
      { channel: 'image', role: 'reference_image' },
    ])).toMatchObject({
      mode: 'reference',
      referenceImageCount: 1,
      firstFrameCount: 0,
      lastFrameCount: 0,
    })

    expect(resolveVideoInputMode([
      { channel: 'image', role: 'reference_image' },
      { channel: 'image', role: 'reference_image' },
      { channel: 'image', role: 'reference_image' },
    ])).toMatchObject({
      mode: 'reference',
      referenceImageCount: 3,
      firstFrameCount: 0,
      lastFrameCount: 0,
    })
  })

  it('resolves one explicit first frame as first-frame mode', () => {
    expect(resolveVideoInputMode([
      { channel: 'image', role: 'first_frame' },
    ])).toEqual({
      mode: 'first_frame',
      firstFrameCount: 1,
      lastFrameCount: 0,
      referenceImageCount: 0,
      referenceAudioCount: 0,
      referenceVideoCount: 0,
      usesLastFrame: false,
    })
  })

  it('resolves explicit first and last frames independent of input order', () => {
    expect(resolveVideoInputMode([
      { channel: 'image', role: 'last_frame' },
      { channel: 'image', role: 'first_frame' },
    ])).toEqual({
      mode: 'first_last_frame',
      firstFrameCount: 1,
      lastFrameCount: 1,
      referenceImageCount: 0,
      referenceAudioCount: 0,
      referenceVideoCount: 0,
      usesLastFrame: true,
    })
  })

  it('counts supported audio and video references without promoting them to frame mode', () => {
    expect(resolveVideoInputMode([
      { channel: 'audio', role: 'reference_audio' },
      { channel: 'video', role: 'reference_video' },
    ])).toEqual({
      mode: 'reference',
      firstFrameCount: 0,
      lastFrameCount: 0,
      referenceImageCount: 0,
      referenceAudioCount: 1,
      referenceVideoCount: 1,
      usesLastFrame: false,
    })
  })

  it('rejects a last frame without a first frame', () => {
    expectModeError(
      [{ channel: 'image', role: 'last_frame' }],
      'VIDEO_MODEL_FRAME_INPUT_INVALID',
    )
  })

  it('rejects duplicate frame roles', () => {
    expectModeError([
      { channel: 'image', role: 'first_frame' },
      { channel: 'image', role: 'first_frame' },
    ], 'VIDEO_MODEL_FRAME_INPUT_INVALID')

    expectModeError([
      { channel: 'image', role: 'first_frame' },
      { channel: 'image', role: 'last_frame' },
      { channel: 'image', role: 'last_frame' },
    ], 'VIDEO_MODEL_FRAME_INPUT_INVALID')
  })

  it('rejects mixed frame and ordinary reference modes', () => {
    expectModeError([
      { channel: 'image', role: 'first_frame' },
      { channel: 'image', role: 'reference_image' },
    ], 'VIDEO_REFERENCE_MODE_CONFLICT')

    expectModeError([
      { channel: 'image', role: 'first_frame' },
      { channel: 'audio', role: 'reference_audio' },
    ], 'VIDEO_REFERENCE_MODE_CONFLICT')
  })

  it('rejects roles that do not belong to their channel', () => {
    expectModeError([
      { channel: 'image', role: 'reference_audio' },
    ], 'VIDEO_REFERENCE_ROLE_INVALID')
    expectModeError([
      { channel: 'audio', role: 'reference_image' },
    ], 'VIDEO_REFERENCE_ROLE_INVALID')
    expectModeError([
      { channel: 'video', role: 'first_frame' },
    ], 'VIDEO_REFERENCE_ROLE_INVALID')
  })
})
