import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const loadPanelsMock = vi.hoisted(() => vi.fn())
const transactionPanelMock = vi.hoisted(() => ({
  updateMany: vi.fn(async () => ({ count: 1 })),
}))
const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: { update: vi.fn(async () => ({})) },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback({
    novelPromotionPanel: transactionPanelMock,
  })),
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

const asciiSpanishPrompt = Array.from({ length: 8 }, () => (
  'La camara sigue a la mujer mientras ella camina por el pasillo y mira hacia la ventana con movimiento suave'
)).join(' ')
const asciiFrenchPrompt = Array.from({ length: 7 }, () => (
  'La camera suit la femme tandis qu elle marche dans le couloir et regarde vers la fenetre avec un mouvement doux'
)).join(' ')
const asciiIndonesianPrompt = Array.from({ length: 8 }, () => (
  'Kamera mengikuti wanita itu saat dia berjalan menuju jendela dan melihat keluar dengan gerakan yang lembut dan tenang'
)).join(' ')

function framePanel(id: string, index: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    storyboardId: 'storyboard-1',
    panelIndex: index,
    linkedToNextPanel: id === 'panel-1',
    updatedAt: new Date('2026-07-12T00:00:00.000Z'),
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
    expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'panel-1',
        linkedToNextPanel: true,
        updatedAt: new Date('2026-07-12T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        firstLastFramePrompt: validPrompt,
        firstLastFramePromptEditedByUser: false,
        firstLastFramePromptSourceFingerprint: expect.any(String),
      }),
    }))
    expect(result).toMatchObject({
      prompt: validPrompt,
      applied: true,
      fallbackUsed: false,
      warnings: ['keep motion subtle'],
    })
  })

  it('parses duration analysis from the same vision call and persists smart binding', async () => {
    loadPanelsMock.mockResolvedValue(context(framePanel('panel-1', 0, {
      videoDurationBinding: null,
    })))
    aiMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({
        transition_prompt: validPrompt,
        duration_analysis: {
          motion_beats: [
            { type: 'body_action', order: 1 },
            { type: 'locomotion', order: 2, parallel_group: 'move' },
            { type: 'camera_standard', order: 2, parallel_group: 'move' },
          ],
          pacing: 'normal',
          continuity: 'good',
          confidence: 0.9,
          reason: '包含转身和位置移动，镜头缓慢推进',
        },
        warnings: [],
      }),
    })

    const result = await handleFirstLastFramePromptTask(job())

    expect(aiMock.executeAiVisionStep).toHaveBeenCalledTimes(1)
    expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        videoDurationBinding: expect.stringContaining('"durationSource":"smart"'),
      }),
    }))
    expect(result.smartDuration).toMatchObject({
      durationSeconds: 8,
      frameCount: 193,
      fps: 24,
      confidence: 0.9,
      source: 'smart',
    })
  })

  it('does not overwrite an existing manual duration binding with smart analysis', async () => {
    loadPanelsMock.mockResolvedValue(context(framePanel('panel-1', 0, {
      videoDurationBinding: JSON.stringify({
        mode: 'manual',
        targetDurationSeconds: 6,
        durationSource: 'manual',
      }),
    })))
    aiMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({
        transition_prompt: validPrompt,
        duration_analysis: {
          motion_beats: [{ type: 'locomotion', order: 1 }],
          pacing: 'slow',
          continuity: 'good',
          confidence: 0.9,
          reason: '大幅移动',
        },
      }),
    })

    const result = await handleFirstLastFramePromptTask(job())

    expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        videoDurationBinding: JSON.stringify({
          mode: 'manual',
          voiceLineIds: [],
          targetDurationSeconds: 6,
          durationSource: 'manual',
        }),
      }),
    }))
    expect(result.smartDuration?.durationSeconds).toBeGreaterThanOrEqual(6)
  })

  it('falls back to 10s smart metadata when duration analysis is invalid but keeps prompt generation successful', async () => {
    aiMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({
        transition_prompt: validPrompt,
        duration_analysis: { motion_beats: [{ type: 'unknown', order: 1 }] },
      }),
    })

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.fallbackUsed).toBe(false)
    expect(result.smartDuration).toMatchObject({
      durationSeconds: 10,
      source: 'fallback',
      fallbackReason: 'invalid_analysis',
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

  it.each([
    ['Arabic output', Array.from({ length: 75 }, () => 'تتحرك').join(' ')],
    ['Cyrillic output', Array.from({ length: 75 }, () => 'движение').join(' ')],
    ['CJK output', Array.from({ length: 75 }, () => '镜头移动').join(' ')],
    ['low Latin-English signal', Array.from({ length: 75 }, () => '1234-!?').join(' ')],
    ['hard cut', `${validPrompt} A hard cut reveals another hallway.`],
    ['scene transition', `${validPrompt} The scene transitions into a distant courtyard.`],
    ['dissolve transition', `${validPrompt} The image dissolves to a new location.`],
    ['new stranger', `${validPrompt} A stranger enters from the doorway.`],
    ['new person', `${validPrompt} A new person appears behind her.`],
    ['new prop', `${validPrompt} She is carrying a newly introduced sword.`],
    ['ASCII Spanish output', asciiSpanishPrompt],
    ['ASCII French output', asciiFrenchPrompt],
    ['ASCII Indonesian output', asciiIndonesianPrompt],
    ['context-absent picked-up prop', `${validPrompt} She picks up a sword from the table.`],
    ['revealed second person', `${validPrompt} The camera reveals a second man near the window.`],
    ['new animal entering', `${validPrompt} A dog enters through the doorway.`],
    ['switch to another location', `${validPrompt} The shot switches to another room.`],
  ])('uses fallback for forbidden or non-English prompt: %s', async (_label, transitionPrompt) => {
    aiMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({ transition_prompt: transitionPrompt }),
    })

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.fallbackUsed).toBe(true)
    expect(result.prompt).toContain('Bridge naturally into the last frame')
    expect(aiMock.executeAiVisionStep).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['non-entity reflections', 'Reflections appear gradually across the glass.'],
    ['non-entity details', 'Fine details emerge as the camera advances.'],
    ['camera motion', 'The camera arrives at the final framing.'],
  ])('accepts valid arrival wording for %s', async (_label, sentence) => {
    const transitionPrompt = `${validPrompt} ${sentence}`
    aiMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({ transition_prompt: transitionPrompt }),
    })

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.fallbackUsed).toBe(false)
    expect(result.prompt).toBe(transitionPrompt)
    expect(aiMock.executeAiVisionStep).toHaveBeenCalledTimes(1)
  })

  it('allows a picked-up prop when the prop is present in the structured panel context', async () => {
    loadPanelsMock.mockResolvedValue(context(framePanel('panel-1', 0, {
      props: '[{"name":"sword"}]',
    })))
    const transitionPrompt = `${validPrompt} She picks up a sword from the table.`
    aiMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({ transition_prompt: transitionPrompt }),
    })

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.fallbackUsed).toBe(false)
    expect(result.prompt).toBe(transitionPrompt)
    expect(aiMock.executeAiVisionStep).toHaveBeenCalledTimes(1)
  })

  it('returns applied=false when prompt context changes during generation', async () => {
    loadPanelsMock
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce(context(framePanel('panel-1', 0, { videoPrompt: 'changed during generation' })))

    const result = await handleFirstLastFramePromptTask(job())

    expect(result.applied).toBe(false)
    expect(transactionPanelMock.updateMany).not.toHaveBeenCalled()
  })

  it('returns applied=false when a user edit changes the panel version during generation', async () => {
    loadPanelsMock
      .mockResolvedValueOnce(context())
      .mockResolvedValueOnce(context(framePanel('panel-1', 0, {
        firstLastFramePrompt: 'new user edit during generation',
        firstLastFramePromptEditedByUser: true,
        updatedAt: new Date('2026-07-12T00:00:01.000Z'),
      })))

    const result = await handleFirstLastFramePromptTask(job('source_change'))

    expect(result.applied).toBe(false)
    expect(transactionPanelMock.updateMany).not.toHaveBeenCalled()
  })

  it('uses a serializable transaction and returns applied=false on an optimistic write conflict', async () => {
    transactionPanelMock.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await handleFirstLastFramePromptTask(job('manual'))

    expect(result.applied).toBe(false)
    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    )
    expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'panel-1',
        linkedToNextPanel: true,
        updatedAt: new Date('2026-07-12T00:00:00.000Z'),
      }),
    }))
  })

  it('rejects persistence when the link is removed during generation', async () => {
    loadPanelsMock
      .mockResolvedValueOnce(context())
      .mockRejectedValueOnce(new Error('First/last frame link was removed'))

    await expect(handleFirstLastFramePromptTask(job())).rejects.toThrow('First/last frame link was removed')
    expect(transactionPanelMock.updateMany).not.toHaveBeenCalled()
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
    expect(transactionPanelMock.updateMany).toHaveBeenCalled()
  })

  it('relink with a new source replaces an old user prompt while preserving in-flight edit CAS', async () => {
    loadPanelsMock.mockResolvedValue(context(framePanel('panel-1', 0, {
      firstLastFramePrompt: 'old manual prompt from the previous link',
      firstLastFramePromptEditedByUser: true,
      firstLastFramePromptSourceFingerprint: 'old-source-fingerprint',
    })))

    const result = await handleFirstLastFramePromptTask(job('link'))

    expect(result.applied).toBe(true)
    expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ firstLastFramePromptEditedByUser: false }),
    }))
  })
})
