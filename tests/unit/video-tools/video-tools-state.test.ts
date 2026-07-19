import { describe, expect, it } from 'vitest'
import {
  canSubmitVideoSeamConcat,
  resolveVideoToolTaskView,
  type UploadedVideo,
  type VideoToolTask,
} from '@/app/[locale]/workspace/video-tools/video-tools-state'

const upload: UploadedVideo = {
  key: 'video-tools/user-1/inputs/one.mp4',
  url: '/api/storage/sign?key=one',
  name: 'one.mp4',
  size: 100,
  mimeType: 'video/mp4',
}

function task(overrides: Partial<VideoToolTask>): VideoToolTask {
  return {
    id: 'task-1',
    status: 'queued',
    progress: 0,
    payload: {},
    result: null,
    error: null,
    ...overrides,
  }
}

describe('video tools state', () => {
  it('enables submission only when both uploads exist and no task is active', () => {
    expect(canSubmitVideoSeamConcat(upload, upload, null)).toBe(true)
    expect(canSubmitVideoSeamConcat(upload, null, null)).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, task({ status: 'processing' }))).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, task({ status: 'completed' }))).toBe(true)
  })

  it('rejects seam-concat submission when either trim is invalid', () => {
    expect(canSubmitVideoSeamConcat(upload, upload, null, 0, 1)).toBe(true)
    expect(canSubmitVideoSeamConcat(upload, upload, null, 0.5, 1)).toBe(false)
    expect(canSubmitVideoSeamConcat(upload, upload, null, 0, -1)).toBe(false)
  })

  it('maps queued, processing, failed, and completed tasks to truthful views', () => {
    expect(resolveVideoToolTaskView(task({ status: 'queued' }))).toMatchObject({ phase: 'queued', active: true })
    expect(resolveVideoToolTaskView(task({ status: 'processing', payload: { stage: 'persist_output' } })))
      .toMatchObject({ phase: 'persisting', active: true })
    expect(resolveVideoToolTaskView(task({
      status: 'failed',
      error: { message: 'ComfyUI failed' },
    }))).toMatchObject({ phase: 'failed', active: false, errorMessage: 'ComfyUI failed' })
    expect(resolveVideoToolTaskView(task({
      status: 'completed',
      result: { videoKey: 'output.mp4', videoUrl: '/api/storage/sign?key=output' },
    }))).toMatchObject({
      phase: 'completed',
      active: false,
      videoUrl: '/api/storage/sign?key=output',
    })
  })

})
