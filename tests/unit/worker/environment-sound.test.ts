import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:8878' })))
const executeAiVisionStepMock = vi.hoisted(() => vi.fn())
const executeAiTextStepMock = vi.hoisted(() => vi.fn())
const resolveAnalysisModelMock = vi.hoisted(() => vi.fn(async () => 'openai::vision-model'))
const getSignedObjectUrlMock = vi.hoisted(() => vi.fn(async (key: string) => `https://storage.test/${key}`))
const getSignedUrlMock = vi.hoisted(() => vi.fn((key: string) => `/api/files/${encodeURIComponent(key)}`))
const uploadObjectMock = vi.hoisted(() => vi.fn(async (_body: Buffer, key: string) => key))
const deleteObjectMock = vi.hoisted(() => vi.fn(async () => undefined))
const addTaskJobMock = vi.hoisted(() => vi.fn(async () => ({ id: 'cleanup-job' })))
const runComfyUiAudioWorkflowMock = vi.hoisted(() => vi.fn(async () => ({
  audioBase64: Buffer.from('mp3-piece').toString('base64'),
  mimeType: 'audio/mpeg',
})))
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const downloadSourceMock = vi.hoisted(() => vi.fn())
const probeMediaMock = vi.hoisted(() => vi.fn())
const detectSceneChangesMock = vi.hoisted(() => vi.fn(async () => [4]))
const extractFramesMock = vi.hoisted(() => vi.fn())
const detectVoiceActivityMock = vi.hoisted(() => vi.fn(async (): Promise<Array<{
  startSeconds: number
  endSeconds: number
}>> => []))
const summarizeVoiceActivityMock = vi.hoisted(() => vi.fn())
const summarizeSourceAudioActivityMock = vi.hoisted(() => vi.fn())
const measureAudioLevelMock = vi.hoisted(() => vi.fn(async () => ({ maxVolumeDb: -6 })))
const composeMp3Mock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-config', () => ({ getProviderConfig: getProviderConfigMock }))
vi.mock('@/lib/ai-runtime', () => ({
  executeAiVisionStep: executeAiVisionStepMock,
  executeAiTextStep: executeAiTextStepMock,
}))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => ({ resolveAnalysisModel: resolveAnalysisModelMock }))
vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: getSignedObjectUrlMock,
  getSignedUrl: getSignedUrlMock,
  uploadObject: uploadObjectMock,
  deleteObject: deleteObjectMock,
}))
vi.mock('@/lib/task/queues', () => ({ addTaskJob: addTaskJobMock }))
vi.mock('@/lib/providers/comfyui/client', () => ({
  runComfyUiAudioWorkflow: runComfyUiAudioWorkflowMock,
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/video-tools/environment-sound-media', () => ({
  downloadEnvironmentSoundSource: downloadSourceMock,
  probeEnvironmentSoundMedia: probeMediaMock,
  detectEnvironmentSoundSceneChanges: detectSceneChangesMock,
  extractEnvironmentSoundFrames: extractFramesMock,
  detectEnvironmentSoundVoiceActivity: detectVoiceActivityMock,
  detectEnvironmentSoundAudioActivity: detectVoiceActivityMock,
  summarizeEnvironmentSoundVoiceActivity: summarizeVoiceActivityMock,
  summarizeEnvironmentSoundSourceAudioActivity: summarizeSourceAudioActivityMock,
  measureEnvironmentSoundAudioLevel: measureAudioLevelMock,
  composeEnvironmentSoundMp3: composeMp3Mock,
}))

function createJob(type: TaskJobData['type'], payload: Record<string, unknown>) {
  return {
    data: {
      taskId: 'task-1',
      type,
      locale: 'zh',
      projectId: 'video-tools',
      targetType: 'EnvironmentSound',
      targetId: 'target-1',
      payload,
      userId: 'user-1',
    } satisfies TaskJobData,
  }
}

const tenSecondPlan = {
  durationSeconds: 10,
  summaryZh: '雨夜街道持续到片尾。',
  zones: [{
    id: 'street',
    startSeconds: 0,
    endSeconds: 10,
    sceneZh: '雨夜街道',
    ambienceZh: '雨声与远处车辆声',
    eventSoundsZh: ['车辆驶过'],
    avoidSoundsZh: ['音乐', '人声'],
    promptEn: 'Continuous realistic rainy night street ambience with wet road hiss and distant passing vehicles in a wide stereo exterior, no music or voices.',
    negativePromptEn: 'music, melody, speech, dialogue, vocals, narration',
    transitionToNext: 'hard',
  }],
}

describe('environment sound worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    downloadSourceMock.mockImplementation(async (_url: string, outputPath: string) => {
      await fs.writeFile(outputPath, Buffer.from('source'))
    })
    probeMediaMock.mockResolvedValue({ durationSeconds: 10, hasAudio: false })
    extractFramesMock.mockImplementation(async (_source: string, outputDir: string) => {
      const filePath = `${outputDir}/frame-01.jpg`
      await fs.mkdir(outputDir, { recursive: true })
      await fs.writeFile(filePath, Buffer.from([1, 2, 3]))
      return [{ timestampSeconds: 0, filePath }]
    })
    composeMp3Mock.mockImplementation(async (params: { outputPath: string }) => {
      await fs.writeFile(params.outputPath, Buffer.from('final-mp3'))
    })
    executeAiVisionStepMock.mockResolvedValue({ text: JSON.stringify(tenSecondPlan) })
    executeAiTextStepMock.mockResolvedValue({
      text: JSON.stringify({
        zones: tenSecondPlan.zones.map((zone) => ({
          id: zone.id,
          promptEn: zone.promptEn,
          negativePromptEn: zone.negativePromptEn,
        })),
      }),
    })
    summarizeVoiceActivityMock.mockImplementation((ranges, voiceDurationSeconds) => ({
      voiceDurationSeconds,
      activeSeconds: 0,
      activeRatio: 0,
      timelineAligned: false,
      activeRanges: [],
    }))
    summarizeSourceAudioActivityMock.mockImplementation((ranges, durationSeconds) => ({
      audioDurationSeconds: durationSeconds,
      activeSeconds: 0,
      activeRatio: 0,
      timelineAligned: true,
      activeRanges: ranges,
    }))
  })

  it('analyzes representative frames once and returns a validated editable plan', async () => {
    const { handleEnvironmentSoundAnalyzeTask } = await import('@/lib/workers/handlers/environment-sound')
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE, {
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      scriptDialogue: '角色走进雨夜街道。',
    })

    const result = await handleEnvironmentSoundAnalyzeTask(job as never)

    expect(resolveAnalysisModelMock).toHaveBeenCalledWith({ userId: 'user-1' })
    expect(executeAiVisionStepMock).toHaveBeenCalledTimes(1)
    expect(executeAiVisionStepMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'openai::vision-model',
      imageUrls: ['data:image/jpeg;base64,AQID'],
      projectId: 'video-tools',
    }))
    expect(result.plan).toEqual(tenSecondPlan)
    expect(result.video).toMatchObject({ durationSeconds: 10, frameCount: 1, hasSourceAudio: false })
    expect(reportTaskProgressMock).toHaveBeenCalled()
  })

  it('marks a shorter voice clip as density-only instead of treating it as video timestamps', async () => {
    const { handleEnvironmentSoundAnalyzeTask } = await import('@/lib/workers/handlers/environment-sound')
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 4, hasAudio: true })
    detectVoiceActivityMock.mockResolvedValueOnce([{ startSeconds: 0, endSeconds: 4 }])
    summarizeVoiceActivityMock.mockReturnValueOnce({
      voiceDurationSeconds: 4,
      activeSeconds: 4,
      activeRatio: 1,
      timelineAligned: false,
      activeRanges: [],
    })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE, {
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      voiceKey: 'video-tools/user-1/voice-inputs/dialogue.mp3',
    })

    const result = await handleEnvironmentSoundAnalyzeTask(job as never)

    expect(executeAiVisionStepMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('"timelineAligned":false'),
    }))
    expect(result.voiceAnalysis).toMatchObject({ timelineAligned: false, activeRanges: [] })
  })

  it('analyzes source-video audio as aligned signal activity without claiming semantic listening', async () => {
    const { handleEnvironmentSoundAnalyzeTask } = await import('@/lib/workers/handlers/environment-sound')
    const sourceRanges = [{ startSeconds: 1, endSeconds: 8 }]
    probeMediaMock.mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
    detectVoiceActivityMock.mockResolvedValueOnce(sourceRanges)
    summarizeSourceAudioActivityMock.mockReturnValueOnce({
      audioDurationSeconds: 10,
      activeSeconds: 7,
      activeRatio: 0.7,
      timelineAligned: true,
      activeRanges: sourceRanges,
    })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE, {
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
    })

    const result = await handleEnvironmentSoundAnalyzeTask(job as never)

    expect(detectVoiceActivityMock).toHaveBeenCalledWith(expect.stringContaining('source.mp4'), 10)
    expect(executeAiVisionStepMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('"activeRatio":0.7'),
    }))
    expect(result.sourceAudioAnalysis).toMatchObject({ timelineAligned: true, activeRanges: sourceRanges })
  })

  it('rejects an oversized video before scene detection or model analysis', async () => {
    const { handleEnvironmentSoundAnalyzeTask } = await import('@/lib/workers/handlers/environment-sound')
    probeMediaMock.mockResolvedValueOnce({ durationSeconds: 3601, hasAudio: false })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_ANALYZE, {
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
    })

    await expect(handleEnvironmentSoundAnalyzeTask(job as never))
      .rejects.toThrow('ENVIRONMENT_SOUND_VIDEO_TOO_LONG')
    expect(detectSceneChangesMock).not.toHaveBeenCalled()
    expect(executeAiVisionStepMock).not.toHaveBeenCalled()
  })

  it('synchronizes edited Chinese plan facts before invoking Stable Audio', async () => {
    const { handleEnvironmentSoundGenerateTask } = await import('@/lib/workers/handlers/environment-sound')
    const editedPlan = structuredClone(tenSecondPlan)
    editedPlan.zones[0]!.ambienceZh = '暴雨敲击铁皮雨棚，近处积水飞溅'
    const synchronizedPrompt = 'Continuous realistic torrential rain striking a corrugated metal awning with close puddle splashes in stereo, no music or voices.'
    executeAiTextStepMock.mockResolvedValueOnce({
      text: JSON.stringify({
        zones: [{
          id: 'street',
          promptEn: synchronizedPrompt,
          negativePromptEn: 'music, melody, speech, dialogue, vocals, narration',
        }],
      }),
    })
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_GENERATE, {
      action: 'generate',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      plan: editedPlan,
    })

    await handleEnvironmentSoundGenerateTask(job as never)

    expect(executeAiTextStepMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({
        content: expect.stringContaining('暴雨敲击铁皮雨棚'),
      })],
    }))
    expect(runComfyUiAudioWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: synchronizedPrompt,
    }))
  })

  it('rejects a duration-mismatched ComfyUI piece before composition can pad it', async () => {
    const { handleEnvironmentSoundGenerateTask } = await import('@/lib/workers/handlers/environment-sound')
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 2, hasAudio: true })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_GENERATE, {
      action: 'generate',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      plan: tenSecondPlan,
    })

    await expect(handleEnvironmentSoundGenerateTask(job as never))
      .rejects.toThrow('ENVIRONMENT_SOUND_PIECE_DURATION_MISMATCH')
    expect(composeMp3Mock).not.toHaveBeenCalled()
  })

  it('rejects a ComfyUI piece without a real audio stream', async () => {
    const { handleEnvironmentSoundGenerateTask } = await import('@/lib/workers/handlers/environment-sound')
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: false })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_GENERATE, {
      action: 'generate',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      plan: tenSecondPlan,
    })

    await expect(handleEnvironmentSoundGenerateTask(job as never))
      .rejects.toThrow('ENVIRONMENT_SOUND_PIECE_AUDIO_MISSING')
    expect(composeMp3Mock).not.toHaveBeenCalled()
  })

  it('rejects a digitally silent ComfyUI piece before composition', async () => {
    const { handleEnvironmentSoundGenerateTask } = await import('@/lib/workers/handlers/environment-sound')
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
    measureAudioLevelMock.mockResolvedValueOnce({ maxVolumeDb: Number.NEGATIVE_INFINITY })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_GENERATE, {
      action: 'generate',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      plan: tenSecondPlan,
    })

    await expect(handleEnvironmentSoundGenerateTask(job as never))
      .rejects.toThrow('ENVIRONMENT_SOUND_PIECE_SILENT')
    expect(composeMp3Mock).not.toHaveBeenCalled()
  })

  it('generates long ambience in pieces and persists one final MP3', async () => {
    const { handleEnvironmentSoundGenerateTask } = await import('@/lib/workers/handlers/environment-sound')
    const longPlan = structuredClone(tenSecondPlan)
    longPlan.durationSeconds = 170
    longPlan.zones[0]!.endSeconds = 170
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 170, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 150, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 21, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 170, hasAudio: true })
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_GENERATE, {
      action: 'generate',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      plan: longPlan,
    })

    const result = await handleEnvironmentSoundGenerateTask(job as never)

    expect(runComfyUiAudioWorkflowMock).toHaveBeenCalledTimes(2)
    expect(runComfyUiAudioWorkflowMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workflowKey: 'baseaudio/environment/stable-audio-3-medium',
      durationSeconds: 150,
      negativePrompt: 'music, melody, speech, dialogue, vocals, narration',
      seed: expect.any(Number),
    }))
    expect(composeMp3Mock).toHaveBeenCalledTimes(1)
    expect(composeMp3Mock).toHaveBeenCalledWith(expect.objectContaining({
      durationSeconds: 170,
      transitions: [1],
    }))
    expect(uploadObjectMock).toHaveBeenCalledWith(
      Buffer.from('final-mp3'),
      expect.stringMatching(/^video-tools\/user-1\/environment-sounds\/.+\.mp3$/),
      1,
      'audio/mpeg',
    )
    expect(result).toMatchObject({
      mimeType: 'audio/mpeg',
      durationSeconds: 170,
      pieceCount: 2,
      audioKey: expect.stringMatching(/\.mp3$/),
      audioUrl: expect.stringContaining('/api/files/'),
    })
    expect(result.seeds).toHaveLength(2)
    expect(addTaskJobMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'environment_sound_cleanup',
      userId: 'user-1',
      payload: expect.objectContaining({
        objectKey: expect.stringMatching(/^video-tools\/user-1\/environment-sounds\/.+\.mp3$/),
      }),
    }), expect.objectContaining({ delay: 86_400_000 }))
    expect(result.expiresAt).toEqual(expect.any(String))
  })

  it('deletes only an owned scheduled object in the cleanup handler', async () => {
    const handlerModule = await import('@/lib/workers/handlers/environment-sound') as typeof import('@/lib/workers/handlers/environment-sound') & {
      handleEnvironmentSoundCleanupTask?: (job: unknown) => Promise<unknown>
    }
    expect(handlerModule.handleEnvironmentSoundCleanupTask).toBeTypeOf('function')
    const job = createJob('environment_sound_cleanup' as TaskJobData['type'], {
      objectKey: 'video-tools/user-1/environment-sounds/output.mp3',
    })

    await handlerModule.handleEnvironmentSoundCleanupTask!(job)

    expect(deleteObjectMock).toHaveBeenCalledWith('video-tools/user-1/environment-sounds/output.mp3')
  })

  it('compensates a generated output when delayed cleanup cannot be scheduled', async () => {
    const { handleEnvironmentSoundGenerateTask } = await import('@/lib/workers/handlers/environment-sound')
    probeMediaMock
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
      .mockResolvedValueOnce({ durationSeconds: 10, hasAudio: true })
    addTaskJobMock.mockRejectedValueOnce(new Error('redis unavailable'))
    const job = createJob(TASK_TYPE.ENVIRONMENT_SOUND_GENERATE, {
      action: 'generate',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      plan: tenSecondPlan,
    })

    await expect(handleEnvironmentSoundGenerateTask(job as never))
      .rejects.toThrow('redis unavailable')
    expect(deleteObjectMock).toHaveBeenCalledWith(expect.stringMatching(
      /^video-tools\/user-1\/environment-sounds\/.+\.mp3$/,
    ))
  })
})
