import { describe, expect, it } from 'vitest'
import * as seamConcat from '@/lib/video-tools/seam-concat'
import {
  VIDEO_TOOL_MAX_UPLOAD_BYTES,
  buildVideoToolInputKey,
  isOwnedVideoToolInputKey,
  parseVideoSeamConcatSubmission,
  validateVideoToolUpload,
} from '@/lib/video-tools/seam-concat'

describe('video seam concat validation', () => {
  it('accepts supported video files below the upload limit', () => {
    expect(validateVideoToolUpload({
      name: 'shot-1-video.mp4',
      type: 'video/mp4',
      size: 7_894_231,
    })).toEqual({ extension: 'mp4', mimeType: 'video/mp4' })
  })

  it('rejects empty, unsupported, and oversized uploads', () => {
    expect(() => validateVideoToolUpload({ name: 'empty.mp4', type: 'video/mp4', size: 0 }))
      .toThrow('VIDEO_TOOL_UPLOAD_EMPTY')
    expect(() => validateVideoToolUpload({ name: 'notes.txt', type: 'text/plain', size: 12 }))
      .toThrow('VIDEO_TOOL_UPLOAD_UNSUPPORTED')
    expect(() => validateVideoToolUpload({
      name: 'huge.mp4',
      type: 'video/mp4',
      size: VIDEO_TOOL_MAX_UPLOAD_BYTES + 1,
    })).toThrow('VIDEO_TOOL_UPLOAD_TOO_LARGE')
  })

  it('builds and validates user-scoped input keys', () => {
    const key = buildVideoToolInputKey('user-1', 'mp4', 'upload-1')
    expect(key).toBe('video-tools/user-1/inputs/upload-1.mp4')
    expect(isOwnedVideoToolInputKey('user-1', key)).toBe(true)
    expect(isOwnedVideoToolInputKey('user-2', key)).toBe(false)
    expect(isOwnedVideoToolInputKey('user-1', '../user-1/inputs/upload-1.mp4')).toBe(false)
  })

  it('parses two owned input keys for task submission', () => {
    expect(parseVideoSeamConcatSubmission('user-1', {
      input1: { key: 'video-tools/user-1/inputs/one.mp4', name: 'one.mp4' },
      input2: { key: 'video-tools/user-1/inputs/two.mp4', name: 'two.mp4' },
    })).toEqual({
      input1Key: 'video-tools/user-1/inputs/one.mp4',
      input1Name: 'one.mp4',
      input1TrimEndFrames: 0,
      input2Key: 'video-tools/user-1/inputs/two.mp4',
      input2Name: 'two.mp4',
      input2TrimStartFrames: 1,
      mode: 'direct',
    })
  })

  it('parses custom input trim frame values', () => {
    expect(parseVideoSeamConcatSubmission('user-1', {
      input1: {
        key: 'video-tools/user-1/inputs/one.mp4',
        name: 'one.mp4',
        trimEndFrames: 12,
      },
      input2: {
        key: 'video-tools/user-1/inputs/two.mp4',
        name: 'two.mp4',
        trimStartFrames: 3,
      },
    })).toMatchObject({ input1TrimEndFrames: 12, input2TrimStartFrames: 3 })
  })

  it('parses an AI bridge request with a supported duration', () => {
    expect(parseVideoSeamConcatSubmission('user-1', {
      input1: { key: 'video-tools/user-1/inputs/one.mp4', name: 'one.mp4' },
      input2: { key: 'video-tools/user-1/inputs/two.mp4', name: 'two.mp4' },
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4, prompt: '  The camera continues forward naturally.  ' },
    })).toMatchObject({
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4, prompt: 'The camera continues forward naturally.' },
    })
  })

  it('rejects invalid input trim frame values', () => {
    const input1 = { key: 'video-tools/user-1/inputs/one.mp4', name: 'one.mp4' }
    const input2 = { key: 'video-tools/user-1/inputs/two.mp4', name: 'two.mp4' }

    for (const trimFrames of [0.5, -1, '1', 100_001]) {
      expect(() => parseVideoSeamConcatSubmission('user-1', {
        input1: { ...input1, trimEndFrames: trimFrames },
        input2,
      })).toThrow('VIDEO_SEAM_CONCAT_TRIM_FRAMES_INVALID')
    }
  })

  it('exposes a frame-trim validity predicate', () => {
    expect('isValidVideoTrimFrames' in seamConcat).toBe(true)
    expect('VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES' in seamConcat).toBe(true)
  })

  it('rejects missing or cross-user input keys', () => {
    expect(() => parseVideoSeamConcatSubmission('user-1', {
      input1: { key: 'video-tools/user-2/inputs/one.mp4', name: 'one.mp4' },
      input2: { key: 'video-tools/user-1/inputs/two.mp4', name: 'two.mp4' },
    })).toThrow('VIDEO_TOOL_INPUT_NOT_OWNED')

    expect(() => parseVideoSeamConcatSubmission('user-1', {}))
      .toThrow('VIDEO_TOOL_INPUTS_REQUIRED')
  })
})
