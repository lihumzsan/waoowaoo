import {
  beforeEach,
  buildJob,
  buildValidPlanText,
  describe,
  execFileMock,
  executeAiTextStepMock,
  expect,
  generateMusicMock,
  it,
  mediaServiceMock,
  mockCompleteTimeline,
  mockReadyProject,
  prismaMock,
  reportTaskProgressMock,
  storageMock,
  vi,
  writeFileSync,
} from './bgm-score-worker.fixture'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'

describe('bgm score worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileMock.mockImplementation((
      command: string,
      args: readonly string[],
      optionsOrCallback: unknown,
      maybeCallback?: unknown,
    ) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      if (typeof callback !== 'function') throw new Error('execFile callback missing')
      if (command === 'ffmpeg') {
        const outputPath = args[args.length - 1]
        if (typeof outputPath === 'string') {
          writeFileSync(outputPath, Buffer.from('mixed-bgm'))
        }
      }
      callback(null, { stdout: '3.500\n', stderr: '' })
    })
    storageMock.uploadObject.mockImplementation(async (_buffer: Buffer, key: string) => key)
    mediaServiceMock.ensureMediaObjectFromStorageKey.mockImplementation(async (storageKey: string) => ({
      id: `media-${storageKey}`,
      url: `/m/${storageKey}`,
    }))
  })

  it('writes completed BGM after one final music generation request', async () => {
    mockReadyProject()
    mockCompleteTimeline()
    executeAiTextStepMock.mockResolvedValue({ text: buildValidPlanText() })
    generateMusicMock.mockResolvedValue({
      success: true,
      audioBase64: Buffer.from('final-bgm').toString('base64'),
      audioMimeType: 'audio/mpeg',
    })

    const { handleBgmScoreGenerateTask } = await import('@/lib/bgm-score/generate')
    const result = await handleBgmScoreGenerateTask(buildJob({
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-pro-preview',
    }))

    const storageKey = buildTaskArtifactStorageKey({
      taskId: 'task-bgm-1',
      artifact: 'bgm-score:mix',
      extension: 'm4a',
    })
    expect(result).toMatchObject({
      episodeId: 'episode-1',
      mediaId: `media-${storageKey}`,
      audioUrl: `/m/${storageKey}`,
      designSectionCount: 2,
      promptSectionCount: 1,
      virtualLayerCount: 2,
    })
    expect(generateMusicMock).toHaveBeenCalledTimes(1)
    expect(String(generateMusicMock.mock.calls[0]?.[2])).toContain('Generate one complete continuous instrumental cinematic BGM track')
    expect(String(generateMusicMock.mock.calls[0]?.[2])).toContain('文本说明用内部编曲层')
    expect(storageMock.uploadObject).toHaveBeenCalledTimes(1)

    const completedCall = prismaMock.projectEditMusicScore.upsert.mock.calls.find((call) => {
      const arg = call[0] as {
        update?: {
          status?: string
          cuesJson?: {
            schemaVersion?: number
            plan?: { virtualLayers?: readonly unknown[]; promptSections?: readonly unknown[] }
          }
          mixJson?: { url?: string; durationMs?: number }
        }
      }
      return arg.update?.status === 'completed'
        && arg.update.cuesJson?.schemaVersion === 2
        && arg.update.mixJson?.url === `/m/${storageKey}`
        && arg.update.mixJson.durationMs === 3500
        && arg.update.cuesJson.plan?.virtualLayers?.length === 2
        && arg.update.cuesJson.plan?.promptSections?.length === 1
    })
    expect(completedCall).toBeTruthy()

    const progressCall = reportTaskProgressMock.mock.calls.find((call) => {
      const payload = call[2] as { stage?: string; designSectionCount?: number; promptSectionCount?: number }
      return payload.stage === 'music_score_plan_generate_music'
        && payload.designSectionCount === 2
        && payload.promptSectionCount === 1
    })
    expect(progressCall).toBeTruthy()
  })
})
