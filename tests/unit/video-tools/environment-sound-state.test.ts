import { describe, expect, it } from 'vitest'
import {
  canAnalyzeEnvironmentSound,
  canGenerateEnvironmentSound,
  resolveEnvironmentSoundTaskView,
  type EnvironmentSoundTask,
  type EnvironmentSoundVideo,
} from '@/app/[locale]/workspace/video-tools/environment-sound-state'

const video: EnvironmentSoundVideo = {
  key: 'video-tools/user-1/outputs/stitched.mp4',
  url: '/api/storage/sign?key=stitched',
  name: 'stitched.mp4',
}

const plan = {
  durationSeconds: 10,
  summaryZh: '雨夜街道',
  zones: [{
    id: 'zone-1',
    startSeconds: 0,
    endSeconds: 10,
    sceneZh: '雨夜街道',
    ambienceZh: '雨声',
    eventSoundsZh: ['汽车'],
    avoidSoundsZh: ['人声'],
    promptEn: 'steady rain ambience with distant urban traffic and occasional passing cars',
    negativePromptEn: 'music, speech, dialogue',
    transitionToNext: 'smooth' as const,
  }],
}

function task(overrides: Partial<EnvironmentSoundTask>): EnvironmentSoundTask {
  return {
    id: 'task-1',
    status: 'queued',
    progress: 0,
    payload: null,
    result: null,
    error: null,
    ...overrides,
  }
}

describe('environment sound UI state', () => {
  it('parses only unexpired reload recovery state for the matching task and video', async () => {
    const stateModule = await import('@/app/[locale]/workspace/video-tools/environment-sound-state') as typeof import('@/app/[locale]/workspace/video-tools/environment-sound-state') & {
      parseEnvironmentSoundRecovery?: (raw: string | null, nowMs: number) => {
        taskId: string
        video: EnvironmentSoundVideo
      } | null
    }
    expect(stateModule.parseEnvironmentSoundRecovery).toBeTypeOf('function')
    const raw = JSON.stringify({
      taskId: 'task-1',
      video,
      expiresAt: '2026-07-23T00:00:00.000Z',
    })

    expect(stateModule.parseEnvironmentSoundRecovery!(raw, Date.parse('2026-07-22T00:00:00.000Z')))
      .toMatchObject({ taskId: 'task-1', video })
    expect(stateModule.parseEnvironmentSoundRecovery!(raw, Date.parse('2026-07-24T00:00:00.000Z')))
      .toBeNull()
    expect(stateModule.parseEnvironmentSoundRecovery!('{bad json', Date.now())).toBeNull()
  })

  it('allows analysis for an owned video only when no task or upload is active', () => {
    expect(canAnalyzeEnvironmentSound(video, null, false)).toBe(true)
    expect(canAnalyzeEnvironmentSound(null, null, false)).toBe(false)
    expect(canAnalyzeEnvironmentSound(video, task({ status: 'processing' }), false)).toBe(false)
    expect(canAnalyzeEnvironmentSound(video, null, true)).toBe(false)
  })

  it('allows generation only after a plan exists and no task is active', () => {
    expect(canGenerateEnvironmentSound(video, plan, null)).toBe(true)
    expect(canGenerateEnvironmentSound(video, null, null)).toBe(false)
    expect(canGenerateEnvironmentSound(video, plan, task({ status: 'queued' }))).toBe(false)
  })

  it('maps analysis plans, generated MP3s, progress, and failures truthfully', () => {
    expect(resolveEnvironmentSoundTaskView(task({
      status: 'completed',
      result: { plan },
    }))).toMatchObject({ active: false, phase: 'planReady', plan })
    expect(resolveEnvironmentSoundTaskView(task({
      status: 'completed',
      result: {
        audioKey: 'output.mp3',
        audioUrl: '/output.mp3',
        durationSeconds: 10,
        expiresAt: '2026-07-23T00:00:00.000Z',
      },
    }))).toMatchObject({
      active: false,
      phase: 'completed',
      audioUrl: '/output.mp3',
      audioKey: 'output.mp3',
      expiresAt: '2026-07-23T00:00:00.000Z',
    })
    expect(resolveEnvironmentSoundTaskView(task({
      status: 'processing',
      payload: { stage: 'environment_sound_generate' },
    }))).toMatchObject({ active: true, phase: 'generating' })
    expect(resolveEnvironmentSoundTaskView(task({
      status: 'failed',
      error: { message: 'ComfyUI failed' },
    }))).toMatchObject({ active: false, phase: 'failed', errorMessage: 'ComfyUI failed' })
  })
})
