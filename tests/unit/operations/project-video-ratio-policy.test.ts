import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { requireProjectVideoRatio } from '@/lib/operations/project-video-ratio-policy'

describe('project video ratio policy', () => {
  it('returns the exact project fact and its deterministic plan fingerprint', () => {
    expect(requireProjectVideoRatio(' 16:9 ')).toEqual({
      value: '16:9',
      fingerprint: createHash('sha256').update('16:9').digest('hex'),
    })
  })

  it('typed-fails missing ratio with the generic Choice commitment correction', () => {
    expect(() => requireProjectVideoRatio(null)).toThrow(expect.objectContaining({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'PROJECT_VIDEO_RATIO_REQUIRED',
        field: 'videoRatio',
        correction: {
          choiceOperationId: 'request_choice',
          commitmentOperationId: 'update_project_config',
          commitmentInputField: 'videoRatio',
        },
      }),
    }))
  })

  it('rejects values outside the canonical project ratio registry', () => {
    expect(() => requireProjectVideoRatio('17:10')).toThrow(expect.objectContaining({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'PROJECT_VIDEO_RATIO_INVALID',
        field: 'videoRatio',
        value: '17:10',
      }),
    }))
  })
})
