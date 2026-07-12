import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const loadPanelsMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: { update: vi.fn(async () => ({})) },
}))
const storageMock = vi.hoisted(() => ({
  extractStorageKey: vi.fn((value: string | null) => value?.replace(/^https?:\/\/[^/]+\//, '').split('?')[0] || null),
  getSignedObjectUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
}))
const configMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'openai::vision-model' })),
}))
const aiMock = vi.hoisted(() => ({ executeAiVisionStep: vi.fn() }))
const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'Image 1 START. Image 2 END. Return English JSON only.'),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/ai-runtime', () => aiMock)
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_FIRST_LAST_FRAME_TRANSITION: 'np_first_last_frame_transition' },
  buildPrompt: promptMock.buildPrompt,
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/novel-promotion/first-last-frame-prompt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/novel-promotion/first-last-frame-prompt')>()),
  loadAdjacentFirstLastFramePanels: loadPanelsMock,
}))

import { handleFirstLastFramePromptTask } from '@/lib/workers/handlers/first-last-frame-prompt'

const validPrompt = [
  'The camera begins locked on the woman beside the rain-streaked window as she slowly raises her gaze.',
  'She takes two measured steps forward while the camera glides gently beside her, preserving her face, dark coat, and the warm room lighting.',
  'Curtains move softly behind her and reflections shift naturally across the glass.',
  'Her motion eases into stillness at the window, matching the final framing exactly without introducing anyone, anything, or any change of scene.',
].join(' ')

function framePanel(id: string, index: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    storyboardId: 'storyboard-1',
    panelIndex: index,
    linkedToNextPanel: id === 'panel-1',
    imageUrl: `images/${id}.png`,
    imageMediaId: `media-${id}`,
    imageMedia: {
      id: `media-${id}`,
      publicId: `public-${id}`,
      storageKey: `images/${id}.png`,
      sha256: `sha-${id}`,
    },
    description: `${id} description`,
    imagePrompt: `${id} image prompt`,
    videoPrompt: `${id} video prompt`,
    firstLastFramePrompt: null,
    firstLastFramePromptEditedByUser: false,
    videoDurationBinding: JSON.stringify({ targetDurationSeconds: 8 }),
    shotType: 'medium',
    cameraMove: 'slow track',
    location: 'room',
    characters: '[{"name":"Woman"}]',
    props: '[]',
    srtSegment: '',
    sceneType: 'dialogue',
    storyboard: {
      episodeId: 'episode-1',
      episode: { novelPromotionProject: { projectId: 'project-1' } },
    },
    ...overrides,
  }
}

function context(first = framePanel('panel-1', 0), last = framePanel('panel-2', 1)) {
  return { firstPanel: first, lastPanel: last, episodeId: 'episode-1' }
}

function job(reason: 'link' | 'source_change' | 'manual' = 'link'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-transition-1',
      type: TASK_TYPE.GENERATE_FIRST_LAST_FRAME_PROMPT,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: { firstPanelId: 'panel-1', lastPanelId: 'panel-2', reason },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('first-last-frame prompt worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadPanelsMock.mockResolvedValue(context())
    aiMock.executeAiVisionStep.mockResolvedValue({
      text: JSON.stringify({ transition_prompt: validPrompt, warnings: ['keep motion subtle'] }),
    })
  })

  it('signs stored images in START/END order, parses JSON, and persists generated state', async () => {
    const result = await handleFirstLastFramePromptTask(job('source_change'))

    expect(aiMock.executeAiVisionStep).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'openai::vision-model',
      prompt: expect.stringMatching(/Image 1 START[\s\S]*Image 2 END/),
      imageUrls: [
        'https://signed.example/images/panel-1.png',
        'https://signed.example/images/panel-2.png',
      ],
      action: 'first_last_frame_transition_prompt',
    }))
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        firstLastFramePrompt: validPrompt,
        firstLastFramePromptEditedByUser: false,
        firstLastFramePromptSourceFingerprint: expect.any(String),
      },
    })
    expect(result).toMatchObject({
      prompt: validPrompt,
      applied: true,
      fallbackUsed: false,
      warnings: ['keep motion subtle'],
    })
  })

  it.each([
    ['invalid model output', async () => aiMock.executeAiVisionStep.mockResolvedValueOnce({ text: '{"wrong":"shape"}' })],
    ['unsupported or failed vision provider', async () => aiMock.executeAiVisionStep.mockRejectedValueOnce(new Error('VISION_PROVIDER_UNSUPPORTED'))],
  ])('uses the deterministic bridge for %s', async (_label, arrange) => {
    await arrange()

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.fallbackUsed).toBe(true)
    expect(result.prompt).toContain('Bridge naturally into the last frame')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('returns applied=false when prompt context changes during generation', async () => {
    loadPanelsMock
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce(context(framePanel('panel-1', 0, { videoPrompt: 'changed during generation' })))

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.applied).toBe(false)
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('rejects persistence when the link is removed during generation', async () => {
    loadPanelsMock
      .mockResolvedValueOnce(context())
      .mockRejectedValueOnce(new Error('First/last frame link was removed'))

    await expect(handleFirstLastFramePromptTask(job())).rejects.toThrow('First/last frame link was removed')
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('fails explicitly when either stored image is missing', async () => {
    loadPanelsMock.mockResolvedValueOnce(context(framePanel('panel-1', 0, {
      imageUrl: null,
      imageMedia: null,
      imageMediaId: null,
    })))

    await expect(handleFirstLastFramePromptTask(job())).rejects.toThrow('missing stored image')
    expect(aiMock.executeAiVisionStep).not.toHaveBeenCalled()
  })

  it('source_change may replace a previously user-edited prompt', async () => {
    loadPanelsMock.mockResolvedValue(context(framePanel('panel-1', 0, {
      firstLastFramePrompt: 'my custom transition',
      firstLastFramePromptEditedByUser: true,
    })))

    const result = await handleFirstLastFramePromptTask(job('source_change'))

    expect(result.applied).toBe(true)
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalled()
  })
})
