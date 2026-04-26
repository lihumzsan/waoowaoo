import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const SINGLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen单图编辑'
const DOUBLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen双图编辑'
const TRIPLE_EDIT_MODEL = 'comfyui::baseimage/图片编辑/qwen三图编辑'
const FLUX_TEXT_TO_IMAGE_MODEL = 'comfyui::baseimage/图片生成/Flux2Klein文生图'
const FLUX_MULTI_EDIT_MODEL = 'comfyui::baseimage/图片编辑/Flux2多图编辑'
const QWEN_STORYBOARD_MODEL = 'comfyui::baseimage/图片分镜/Qwen剧情分镜制作'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({
    storyboardModel: 'storyboard-model-1',
    artStyle: 'realistic',
    editModel: SINGLE_EDIT_MODEL,
  })),
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn((value: string | null | undefined) =>
    typeof value === 'string' && value.trim() ? `signed:${value}` : null,
  ),
  uploadImageSourceToCos: vi.fn(),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelReferenceImages: vi.fn(async () => ['https://signed.example/ref-1.png']),
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [],
    locations: [
      {
        name: 'Old Town',
        images: [
          {
            isSelected: true,
            description: 'night street',
            availableSlots: JSON.stringify(['left-side empty area']),
          },
        ],
      },
    ],
  })),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async (refs: string[]) =>
    refs.map((ref) => `normalized:${ref}`),
  ),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'panel-image-prompt'),
}))

const apiConfigMock = vi.hoisted(() => ({
  getUserModels: vi.fn(async () => [
    { modelKey: 'storyboard-model-1', type: 'image' },
    { modelKey: FLUX_TEXT_TO_IMAGE_MODEL, type: 'image' },
    { modelKey: SINGLE_EDIT_MODEL, type: 'image' },
    { modelKey: DOUBLE_EDIT_MODEL, type: 'image' },
    { modelKey: TRIPLE_EDIT_MODEL, type: 'image' },
    { modelKey: FLUX_MULTI_EDIT_MODEL, type: 'image' },
  ]),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  })),
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    collectPanelReferenceImages: sharedMock.collectPanelReferenceImages,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_SINGLE_PANEL_IMAGE: 'np_single_panel_image' },
  buildPrompt: promptMock.buildPrompt,
}))

import { handlePanelImageTask } from '@/lib/workers/handlers/panel-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'panel-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-image-1',
      type: TASK_TYPE.IMAGE_PANEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker panel-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: 'dramatic',
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default', slot: 'left-side empty area' }]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: 'images/sketch.png',
      imageUrl: null,
    })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(null)

    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-source-1')
      .mockResolvedValueOnce('generated-source-2')

    utilsMock.uploadImageSourceToCos
      .mockResolvedValueOnce('cos/panel-candidate-1.png')
      .mockResolvedValueOnce('cos/panel-candidate-2.png')
  })

  it('missing panelId -> explicit error', async () => {
    const job = buildJob({}, '')
    await expect(handlePanelImageTask(job)).rejects.toThrow('panelId missing')
  })

  it('first generation -> persists main image and candidate list', async () => {
    const job = buildJob({ candidateCount: 2 })
    const result = await handlePanelImageTask(job)

    expect(result).toEqual({
      panelId: 'panel-1',
      candidateCount: 2,
      imageUrl: 'cos/panel-candidate-1.png',
    })

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'storyboard-model-1',
        prompt: expect.stringContaining('执行优先级修正'),
        allowTaskExternalIdResume: false,
        options: expect.objectContaining({
          referenceImages: ['normalized:https://signed.example/ref-1.png'],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        storyboard_text_json_input: expect.stringContaining('"slot": "left-side empty area"'),
      }),
    }))
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        storyboard_text_json_input: expect.stringContaining('"available_slots"'),
      }),
    }))

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        imageUrl: 'cos/panel-candidate-1.png',
        candidateImages: JSON.stringify(['cos/panel-candidate-1.png', 'cos/panel-candidate-2.png']),
      },
    })
  })

  it('regeneration branch -> keeps old image in previousImageUrl and stores candidates only', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.uploadImageSourceToCos.mockReset()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      imagePrompt: null,
      videoPrompt: 'dramatic',
      location: 'Old Town',
      characters: '[]',
      srtSegment: null,
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: 'images/sketch.png',
      imageUrl: 'cos/panel-old.png',
    })

    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-source-regen')
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-regenerated.png')

    const job = buildJob({ candidateCount: 1 })
    const result = await handlePanelImageTask(job)

    expect(result).toEqual({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: null,
    })

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        previousImageUrl: 'cos/panel-old.png',
        candidateImages: JSON.stringify(['cos/panel-regenerated.png']),
      },
    })
  })

  it('prefers payload imageModel over project storyboardModel', async () => {
    const job = buildJob({
      candidateCount: 1,
      imageModel: 'comfyui::baseimage/图片生成/ZImageTurbo造像',
    })

    await handlePanelImageTask(job)

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'comfyui::baseimage/图片生成/ZImageTurbo造像',
      }),
    )
  })

  it('keeps qwen storyboard path for non-square projects when a sketch exists', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up in hallway',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: 'images/sketch.png',
      imageUrl: null,
    })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      imageUrl: 'images/previous-panel.png',
      linkedToNextPanel: false,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [
        {
          name: 'Hero',
          appearances: [{
            changeReason: 'default',
            description: 'hero',
            descriptions: JSON.stringify(['hero']),
            imageUrls: JSON.stringify(['images/hero.png']),
            imageUrl: 'images/hero.png',
            selectedIndex: 0,
          }],
        },
      ],
      locations: [
        {
          name: 'Old Town',
          images: [{
            isSelected: true,
            description: 'night clinic',
            imageUrl: 'images/location.png',
            availableSlots: JSON.stringify(['left']),
          }],
        },
      ],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-scene-source')
    utilsMock.uploadImageSourceToCos.mockReset()
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-qwen.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: QWEN_STORYBOARD_MODEL,
        prompt: expect.stringContaining('参考图只用于辅助当前分镜'),
        options: expect.objectContaining({
          referenceImages: [
            'normalized:signed:images/sketch.png',
          ],
          aspectRatio: '16:9',
        }),
      }),
    )
  })

  it('routes qwen storyboard without a sketch to text-to-image for non-square projects', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up in hallway',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      imageUrl: 'images/previous-panel.png',
      linkedToNextPanel: false,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [
        {
          name: 'Hero',
          appearances: [{
            changeReason: 'default',
            description: 'hero',
            descriptions: JSON.stringify(['hero']),
            imageUrls: JSON.stringify(['images/hero.png']),
            imageUrl: 'images/hero.png',
            selectedIndex: 0,
          }],
        },
      ],
      locations: [
        {
          name: 'Old Town',
          images: [{
            isSelected: true,
            description: 'night clinic',
            imageUrl: 'images/location.png',
            availableSlots: JSON.stringify(['left']),
          }],
        },
      ],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-scene-source')
    utilsMock.uploadImageSourceToCos.mockReset()
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-qwen.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
        options: expect.objectContaining({
          referenceImages: [],
          aspectRatio: '16:9',
        }),
      }),
    )
  })

  it('still uses definition-aware edit references for square qwen storyboard projects', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up in hallway',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: 'images/sketch.png',
      imageUrl: null,
    })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      imageUrl: 'images/previous-panel.png',
      linkedToNextPanel: false,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '1:1',
      characters: [
        {
          name: 'Hero',
          appearances: [{
            changeReason: 'default',
            description: 'hero',
            descriptions: JSON.stringify(['hero']),
            imageUrls: JSON.stringify(['images/hero.png']),
            imageUrl: 'images/hero.png',
            selectedIndex: 0,
          }],
        },
      ],
      locations: [
        {
          name: 'Old Town',
          images: [{
            isSelected: true,
            description: 'night clinic',
            imageUrl: 'images/location.png',
            availableSlots: JSON.stringify(['left']),
          }],
        },
      ],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-scene-source')
    utilsMock.uploadImageSourceToCos.mockReset()
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-qwen-square.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: DOUBLE_EDIT_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:signed:images/sketch.png',
            'normalized:signed:images/hero.png',
          ],
          aspectRatio: '1:1',
        }),
      }),
    )
  })

  it('routes qwen storyboard workflow to text-to-image and blocks source-text characters when panel characters are empty', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'wide',
      cameraMove: 'push',
      description: 'empty hallway',
      imagePrompt: null,
      videoPrompt: null,
      location: 'Old Town',
      characters: '[]',
      srtSegment: 'hero is escorted by two nurses',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [],
      locations: [
        {
          name: 'Old Town',
          images: [{
            isSelected: true,
            description: 'night clinic',
            imageUrl: 'images/location.png',
            availableSlots: JSON.stringify(['left']),
          }],
        },
      ],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-text-source')
    utilsMock.uploadImageSourceToCos.mockReset()
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-qwen-empty.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        source_text: 'empty hallway',
      }),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
        prompt: expect.stringContaining('panel.characters 为空数组'),
        options: expect.objectContaining({
          referenceImages: [],
          aspectRatio: '16:9',
        }),
      }),
    )
  })

  it('keeps 3+ character generation on the single-pass path by default', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'medium',
      cameraMove: 'follow',
      description: 'three people walking together',
      imagePrompt: 'three character composition',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([
        { name: 'Hero', appearance: 'default' },
        { name: 'Doctor A', appearance: 'default' },
        { name: 'Doctor B', appearance: 'default' },
      ]),
      srtSegment: 'three-character shot',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: 'images/sketch.png',
      imageUrl: null,
    })

    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [
        {
          name: 'Hero',
          appearances: [{
            changeReason: 'default',
            description: 'hero',
            descriptions: JSON.stringify(['hero']),
            imageUrls: JSON.stringify(['images/hero.png']),
            imageUrl: 'images/hero.png',
            selectedIndex: 0,
          }],
        },
        {
          name: 'DoctorA',
          appearances: [{
            changeReason: 'default',
            description: 'doctor-a',
            descriptions: JSON.stringify(['doctor-a']),
            imageUrls: JSON.stringify(['images/doctor-a.png']),
            imageUrl: 'images/doctor-a.png',
            selectedIndex: 0,
          }],
        },
        {
          name: 'DoctorB',
          appearances: [{
            changeReason: 'default',
            description: 'doctor-b',
            descriptions: JSON.stringify(['doctor-b']),
            imageUrls: JSON.stringify(['images/doctor-b.png']),
            imageUrl: 'images/doctor-b.png',
            selectedIndex: 0,
          }],
        },
      ],
      locations: [
        {
          name: 'Old Town',
          images: [{
            isSelected: true,
            description: 'night clinic',
            imageUrl: 'images/location.png',
            availableSlots: JSON.stringify(['left', 'center', 'right']),
          }],
        },
      ],
    } as never)

    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-three-character-source')
    utilsMock.uploadImageSourceToCos.mockReset()
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-three-character.png')

    const result = await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    expect(result).toEqual({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: 'cos/panel-three-character.png',
    })

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'storyboard-model-1',
        options: expect.objectContaining({
          aspectRatio: '16:9',
          referenceImages: ['normalized:https://signed.example/ref-1.png'],
        }),
      }),
    )
  })
})
