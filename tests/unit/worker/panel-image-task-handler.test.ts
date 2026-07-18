import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getArtStylePrompt } from '@/lib/constants'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'

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
    findMany: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  task: {
    update: vi.fn(async () => ({})),
  },
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({
    storyboardModel: 'storyboard-model-1',
    analysisModel: 'analysis-model-1',
    artStyle: 'realistic',
    editModel: SINGLE_EDIT_MODEL,
  })),
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn((value: string | null | undefined) =>
    typeof value === 'string' && value.trim() ? `signed:${value}` : null,
  ),
  uploadImageSourceToCos: vi.fn(),
  uploadImageSourceToCosWithMetadata: vi.fn(),
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiVisionStep: vi.fn(),
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
vi.mock('@/lib/ai-runtime/client', () => aiRuntimeMock)
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

function mockImageUploads(...keys: string[]) {
  utilsMock.uploadImageSourceToCos.mockReset()
  utilsMock.uploadImageSourceToCosWithMetadata.mockReset()
  for (const key of keys) {
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce(key)
    utilsMock.uploadImageSourceToCosWithMetadata.mockResolvedValueOnce({
      key,
      metadata: { mimeType: 'image/png', sizeBytes: 1024, width: 1280, height: 720 },
    })
  }
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
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([])
    prismaMock.task.update.mockResolvedValue({})
    prismaMock.mediaObject.findUnique.mockResolvedValue(null)
    prismaMock.mediaObject.upsert.mockImplementation(async (args: {
      create: {
        publicId: string
        storageKey: string
        mimeType?: string | null
        sizeBytes?: bigint | number | null
        width?: number | null
        height?: number | null
        durationMs?: number | null
      }
    }) => ({
      id: `media:${args.create.storageKey}`,
      publicId: args.create.publicId,
      storageKey: args.create.storageKey,
      sha256: null,
      mimeType: args.create.mimeType ?? null,
      sizeBytes: args.create.sizeBytes ?? null,
      width: args.create.width ?? null,
      height: args.create.height ?? null,
      durationMs: args.create.durationMs ?? null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }))

    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-source-1')
      .mockResolvedValueOnce('generated-source-2')

    utilsMock.uploadImageSourceToCos
      .mockResolvedValueOnce('cos/panel-candidate-1.png')
      .mockResolvedValueOnce('cos/panel-candidate-2.png')
    utilsMock.uploadImageSourceToCosWithMetadata
      .mockResolvedValueOnce({
        key: 'cos/panel-candidate-1.png',
        metadata: { mimeType: 'image/png', sizeBytes: 1024, width: 1280, height: 720 },
      })
      .mockResolvedValueOnce({
        key: 'cos/panel-candidate-2.png',
        metadata: { mimeType: 'image/png', sizeBytes: 1024, width: 1280, height: 720 },
      })
    aiRuntimeMock.executeAiVisionStep.mockResolvedValue({
      text: JSON.stringify({ passes: true, issues: [] }),
    })
  })

  it('missing panelId -> explicit error', async () => {
    const job = buildJob({}, '')
    await expect(handlePanelImageTask(job)).rejects.toThrow('panelId missing')
  })

  it('first generation -> persists main image and candidate list', async () => {
    const job = buildJob({ candidateCount: 2 })
    const result = await handlePanelImageTask(job)

    expect(result).toEqual(expect.objectContaining({
      panelId: 'panel-1',
      candidateCount: 2,
      imageUrl: 'cos/panel-candidate-1.png',
    }))

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
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prompt: expect.stringContaining('Visible character count lock: exactly 1 named character(s) may appear: Hero.'),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prompt: expect.stringContaining('This is a one-person shot. Show only Hero; do not create a second copy'),
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
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        source_text: 'dialogue segment',
        storyboard_text_json_input: expect.stringContaining('"continuity"'),
      }),
    }))

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        imageUrl: 'cos/panel-candidate-1.png',
        imageMediaId: 'media:cos/panel-candidate-1.png',
        candidateImages: JSON.stringify(['cos/panel-candidate-1.png', 'cos/panel-candidate-2.png']),
      },
    })
  })

  it('sanitizes off-screen people from single-character image prompt facts', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 1,
      shotType: '平视近景',
      cameraMove: '缓缓推近',
      description: '近景：老刘坐在桌前，眼睛注视前方对面的陈迹。',
      imagePrompt: null,
      videoPrompt: null,
      location: '办公室_夜间',
      characters: JSON.stringify([{ name: '老刘', appearance: '初始形象' }]),
      srtSegment: '老刘认真打量对面的少年。',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [
        {
          name: '老刘',
          appearances: [{
            changeReason: '初始形象',
            description: 'middle-aged doctor',
            descriptions: JSON.stringify(['middle-aged doctor']),
            imageUrls: JSON.stringify([]),
            imageUrl: null,
            selectedIndex: 0,
          }],
        },
        {
          name: '陈迹',
          appearances: [],
        },
      ],
      locations: [],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-sanitized-source')
    mockImageUploads('cos/panel-sanitized.png')

    await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    const buildPromptCalls = promptMock.buildPrompt.mock.calls as unknown as Array<[{
      variables: Record<string, string>
    }]>
    const promptArgs = buildPromptCalls[buildPromptCalls.length - 1]?.[0]
    expect(promptArgs).toBeTruthy()
    expect(promptArgs.variables.source_text).not.toContain('少年')
    expect(promptArgs.variables.source_text).toContain('镜头外对象')
    expect(promptArgs.variables.storyboard_text_json_input).not.toContain('陈迹')
    expect(promptArgs.variables.storyboard_text_json_input).toContain('画外对象（不可见，不得绘制）')
    expect(promptArgs.variables.storyboard_text_json_input).toContain('画面只显示老刘')
  })

  it('blocks candidate persistence when generated image aspect ratio is not compliant', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-wrong-aspect-source')
    utilsMock.uploadImageSourceToCosWithMetadata.mockReset()
    utilsMock.uploadImageSourceToCosWithMetadata.mockResolvedValueOnce({
      key: 'cos/panel-wrong-aspect.png',
      metadata: { mimeType: 'image/png', sizeBytes: 1024, width: 720, height: 1280 },
    })

    await expect(handlePanelImageTask(buildJob({ candidateCount: 1 }))).rejects.toThrow(
      'PANEL_IMAGE_AUDIT_ASPECT_RATIO_MISMATCH',
    )

    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
    expect(prismaMock.task.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-panel-image-1' },
      data: expect.objectContaining({
        result: expect.objectContaining({
          panelImageAudit: expect.objectContaining({
            code: 'PANEL_IMAGE_AUDIT_ASPECT_RATIO_MISMATCH',
          }),
        }),
      }),
    }))
  })

  it('records audit report and persists candidate when vision audit detects wrong content', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-wrong-content-source')
    mockImageUploads('cos/panel-wrong-content.png')
    aiRuntimeMock.executeAiVisionStep.mockResolvedValueOnce({
      text: JSON.stringify({
        passes: false,
        issues: ['wrong people', 'wrong scene'],
      }),
    })

    const result = await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    expect(result).toEqual(expect.objectContaining({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: 'cos/panel-wrong-content.png',
      panelImageAuditReports: [
        expect.objectContaining({
          ok: false,
          code: 'PANEL_IMAGE_AUDIT_CONTENT_MISMATCH',
          issues: ['wrong people', 'wrong scene'],
        }),
      ],
    }))
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        imageUrl: 'cos/panel-wrong-content.png',
      }),
    }))
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('records audit report and persists candidate when vision runtime is unavailable', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-vision-runtime-source')
    mockImageUploads('cos/panel-vision-runtime.png')
    aiRuntimeMock.executeAiVisionStep.mockRejectedValueOnce(new Error('401 User not found.'))

    const result = await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    expect(result).toEqual(expect.objectContaining({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: 'cos/panel-vision-runtime.png',
      panelImageAuditReports: [
        expect.objectContaining({
          ok: false,
          code: 'PANEL_IMAGE_AUDIT_VISION_RUNTIME_FAILED',
          message: expect.stringContaining('401 User not found.'),
        }),
      ],
    }))
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        imageUrl: 'cos/panel-vision-runtime.png',
      }),
    }))
  })

  it('regeneration branch -> keeps old image in previousImageUrl and stores candidates only', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    mockImageUploads('cos/panel-regenerated.png')

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
      imageMediaId: null,
      previousImageUrl: null,
      previousImageMediaId: null,
    })

    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-source-regen')

    const job = buildJob({ candidateCount: 1 })
    const result = await handlePanelImageTask(job)

    expect(result).toEqual(expect.objectContaining({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: null,
    }))

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        previousImageUrl: 'cos/panel-old.png',
        previousImageMediaId: 'media:cos/panel-old.png',
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

  it('passes Codex storyboard payloads through to image generation with normalized references', async () => {
    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: CODEX_DEFAULT_IMAGE_MODEL_KEY,
        options: expect.objectContaining({
          referenceImages: ['normalized:https://signed.example/ref-1.png'],
        }),
      }),
    )
  })

  it('keeps chinese-comic text-to-image workflow and appends project style authority', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      storyboardModel: QWEN_STORYBOARD_MODEL,
      analysisModel: 'analysis-model-1',
      artStyle: 'chinese-comic',
      editModel: SINGLE_EDIT_MODEL,
    })
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-comic-source')
    mockImageUploads('cos/panel-comic.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: FLUX_TEXT_TO_IMAGE_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    const generationArgs = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]
    expect(generationArgs?.modelId).toBe(FLUX_TEXT_TO_IMAGE_MODEL)
    expect(generationArgs?.prompt).toContain(getArtStylePrompt('chinese-comic', 'zh'))
    expect(generationArgs?.prompt).toContain('项目风格定义：')
    expect(generationArgs?.prompt).toContain('参考图只提供人物身份、服装、体型、场景布局和氛围线索')
    expect(generationArgs?.prompt).toContain('参考图不能覆盖项目风格的媒介、渲染方式或成片质感')
    expect(generationArgs?.prompt).toContain('当参考图质感与项目风格冲突时，以项目风格定义为准')
    expect(generationArgs?.prompt).not.toContain('现代高质量国漫/2D漫画成片')
    expect(generationArgs?.prompt).not.toContain('禁止输出真人照片')
  })

  it('keeps realistic text-to-image workflow and appends realistic story style definition', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      storyboardModel: QWEN_STORYBOARD_MODEL,
      analysisModel: 'analysis-model-1',
      artStyle: 'realistic',
      editModel: SINGLE_EDIT_MODEL,
    })
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-realistic-source')
    mockImageUploads('cos/panel-realistic.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: FLUX_TEXT_TO_IMAGE_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
      }),
    )
    const generationArgs = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]
    expect(generationArgs?.prompt).toContain(getArtStylePrompt('realistic', 'zh'))
  })

  it('appends project style authority to qwen storyboard identity edit without hardcoded style bans', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      storyboardModel: QWEN_STORYBOARD_MODEL,
      analysisModel: 'analysis-model-1',
      artStyle: 'chinese-comic',
      editModel: SINGLE_EDIT_MODEL,
    })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'static',
      description: '中年医生 close-up in hallway',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([{ name: '中年医生', appearance: 'default' }]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [
        {
          name: '中年医生',
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
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-qwen-style-base')
      .mockResolvedValueOnce('generated-qwen-style-source')
    mockImageUploads('cos/panel-qwen-style.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    const baseArgs = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]
    const generationArgs = utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]
    expect(baseArgs?.modelId).toBe(FLUX_TEXT_TO_IMAGE_MODEL)
    expect(baseArgs?.options?.referenceImages).toEqual([])
    expect(generationArgs?.modelId).toBe(FLUX_MULTI_EDIT_MODEL)
    expect(generationArgs?.options?.referenceImages).toEqual([
      'normalized:generated-qwen-style-base',
      'normalized:signed:images/hero.png',
    ])
    expect(generationArgs?.prompt).toContain(getArtStylePrompt('chinese-comic', 'zh'))
    expect(generationArgs?.prompt).toContain('风格优先级：必须以项目风格定义作为最终画面风格的最高依据')
    expect(generationArgs?.prompt).toContain('参考图只提供人物身份、服装、体型、场景布局和氛围线索')
    expect(generationArgs?.prompt).not.toContain('现代高质量国漫/2D漫画成片')
    expect(generationArgs?.prompt).not.toContain('禁止输出真人照片')
  })

  it('keeps sketched qwen storyboard shots on the controlled storyboard workflow', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'static',
      description: '中年医生 close-up in hallway',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([{ name: '中年医生', appearance: 'default' }]),
      srtSegment: 'dialogue segment',
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
    mockImageUploads('cos/panel-qwen.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: QWEN_STORYBOARD_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:signed:images/sketch.png',
          ],
          aspectRatio: '16:9',
        }),
        prompt: expect.stringContaining('参考图只用于辅助当前分镜的场景'),
      }),
    )
  })

  it('routes single-character qwen storyboard without a sketch through identity edit references', async () => {
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
      characters: JSON.stringify([{ name: '中年医生', appearance: 'default' }]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
    sharedMock.resolveNovelData.mockResolvedValueOnce({
      videoRatio: '16:9',
      characters: [
        {
          name: '中年医生',
          appearances: [{
            changeReason: 'default',
            description: 'doctor',
            descriptions: JSON.stringify(['doctor']),
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
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-base-composition')
      .mockResolvedValueOnce('generated-identity-source')
    mockImageUploads('cos/panel-qwen.png')

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
        options: expect.objectContaining({
          referenceImages: [],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_MULTI_EDIT_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:generated-base-composition',
            'normalized:signed:images/hero.png',
          ],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('if the base composition face conflicts with a character asset, repaint the visible face to match the asset'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Different character slots'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Composition slot rule'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Slot-aware background rule'),
    }))
    const uploadedSource = utilsMock.uploadImageSourceToCosWithMetadata.mock.calls[0]?.[0]
    expect(uploadedSource).toBe('generated-identity-source')
    expect(result.panelImageGenerationPacket.references).toEqual([
      { index: 0, url: 'normalized:signed:images/hero.png' },
    ])
  })

  it('blocks over-the-shoulder foreground people in single-character qwen storyboard prompts', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-2',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'over-the-shoulder close-up',
      cameraMove: 'push in',
      description: 'Over-the-shoulder close-up: Hero looks toward Doctor outside frame, with Doctor shoulder implied in the foreground.',
      imagePrompt: 'Hero reacts to the off-screen Doctor.',
      videoPrompt: 'Hero looks toward the off-screen Doctor while the camera pushes in.',
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default', slot: 'front visitor chair' }]),
      srtSegment: 'Doctor asks a question.',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
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
          name: 'Doctor',
          appearances: [{
            changeReason: 'default',
            description: 'doctor',
            descriptions: JSON.stringify(['doctor']),
            imageUrls: JSON.stringify(['images/doctor.png']),
            imageUrl: 'images/doctor.png',
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
            availableSlots: JSON.stringify(['front visitor chair', 'doctor chair']),
          }],
        },
      ],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-base-composition')
      .mockResolvedValueOnce('generated-identity-source')
    mockImageUploads('cos/panel-no-over-shoulder.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }, 'panel-2'))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Single-character reverse-shot rule'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Single-character reverse-shot rule'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Do not include over-the-shoulder foreground shoulder'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.not.stringContaining('Doctor shoulder implied'),
    }))
  })

  it('uses a confirmed previous same-location panel as qwen storyboard scene continuity base', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-2',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'push in',
      description: 'hero close-up in the same office',
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
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-0',
        panelIndex: 0,
        shotType: 'wide',
        description: 'confirmed wide office panel',
        srtSegment: 'dialogue segment',
        characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
        imageUrl: 'images/previous-office.png',
      },
    ])
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
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-continuity-source')
    mockImageUploads('cos/panel-continuity.png')

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }, 'panel-2'))

    expect(prismaMock.novelPromotionPanel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        storyboardId: 'storyboard-1',
        location: 'Old Town',
        panelIndex: { lt: 2 },
        imageUrl: { not: null },
      }),
      orderBy: { panelIndex: 'desc' },
    }))
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_MULTI_EDIT_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:signed:images/previous-office.png',
            'normalized:signed:images/hero.png',
            'normalized:signed:images/location.png',
          ],
          aspectRatio: '16:9',
        }),
        prompt: expect.stringContaining('Scene continuity lock: reference image 1 is a confirmed neighboring panel'),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('secondary location proof only'),
    }))
    expect(result.panelImageGenerationPacket.modelRoutingReason).toBe('qwen_storyboard_tight_scene_one_character_identity_edit_with_panel_continuity')
    expect(result.panelImageGenerationPacket.references).toEqual([
      { index: 0, url: 'normalized:signed:images/hero.png' },
      { index: 1, url: 'normalized:signed:images/previous-office.png' },
      { index: 2, url: 'normalized:signed:images/location.png' },
    ])
  })

  it('does not lock qwen storyboard continuity across different source beats for the same character', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-2',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'push in',
      description: 'Hero close-up from a new reverse angle in the same office',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default', slot: 'front visitor chair' }]),
      srtSegment: 'current dialogue beat',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-1',
        panelIndex: 1,
        shotType: 'close-up',
        description: 'Hero close-up in the same office but earlier dialogue',
        srtSegment: 'previous dialogue beat',
        characters: JSON.stringify([{ name: 'Hero', appearance: 'default', slot: 'front visitor chair' }]),
        imageUrl: 'images/previous-same-character.png',
      },
    ])
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
            availableSlots: JSON.stringify(['front visitor chair', 'doctor chair']),
          }],
        },
      ],
    } as never)
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-base-composition')
      .mockResolvedValueOnce('generated-identity-source')
    mockImageUploads('cos/panel-no-stale-continuity.png')

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }, 'panel-2'))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
        options: expect.objectContaining({
          referenceImages: [],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_MULTI_EDIT_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:generated-base-composition',
            'normalized:signed:images/hero.png',
          ],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('front visitor chair'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('不得复用完全相同的背景板'),
    }))
    expect(utilsMock.resolveImageSourceFromGeneration.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining('Single-character image rule'),
    }))
    expect(result.panelImageGenerationPacket.modelRoutingReason).toBe('qwen_storyboard_tight_scene_one_character_identity_edit')
    expect(result.panelImageGenerationPacket.references).toEqual([
      { index: 0, url: 'normalized:signed:images/hero.png' },
    ])
  })

  it('does not reuse previous panel continuity when the same-location panel shows a different character', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-2',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'close-up',
      cameraMove: 'push in',
      description: 'Hero close-up from the opposite side of the office',
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
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-1',
        panelIndex: 1,
        shotType: 'close-up',
        description: 'OtherHero close-up in the same office',
        srtSegment: 'dialogue segment',
        characters: JSON.stringify([{ name: 'OtherHero', appearance: 'default' }]),
        imageUrl: 'images/previous-other-character.png',
      },
    ])
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
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-base-composition')
      .mockResolvedValueOnce('generated-identity-source')
    mockImageUploads('cos/panel-no-cross-character-continuity.png')

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }, 'panel-2'))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
        options: expect.objectContaining({
          referenceImages: [],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_MULTI_EDIT_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:generated-base-composition',
            'normalized:signed:images/hero.png',
          ],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(result.panelImageGenerationPacket.modelRoutingReason).toBe('qwen_storyboard_tight_scene_one_character_identity_edit')
    expect(result.panelImageGenerationPacket.references).toEqual([
      { index: 0, url: 'normalized:signed:images/hero.png' },
    ])
  })

  it('routes two-character qwen storyboard without a sketch through identity edit references', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      shotType: 'wide',
      cameraMove: 'static',
      description: 'hero and doctor stand in the old town street',
      imagePrompt: 'panel anchor prompt',
      videoPrompt: null,
      location: 'Old Town',
      characters: JSON.stringify([
        { name: 'Hero', appearance: 'default' },
        { name: 'DoctorA', appearance: 'default' },
      ]),
      srtSegment: 'dialogue segment',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
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
    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-two-character-base')
      .mockResolvedValueOnce('generated-two-character-identity-source')
    mockImageUploads('cos/panel-wide.png')

    const result = await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(2)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_TEXT_TO_IMAGE_MODEL,
        options: expect.objectContaining({
          referenceImages: [],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        modelId: FLUX_MULTI_EDIT_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:generated-two-character-base',
            'normalized:signed:images/hero.png',
            'normalized:signed:images/doctor-a.png',
            'normalized:signed:images/location.png',
          ],
          aspectRatio: '16:9',
        }),
      }),
    )
    expect(utilsMock.uploadImageSourceToCosWithMetadata.mock.calls[0]?.[0]).toBe('generated-two-character-identity-source')
    expect(result.panelImageGenerationPacket.references).toEqual([
      { index: 0, url: 'normalized:signed:images/hero.png' },
      { index: 1, url: 'normalized:signed:images/doctor-a.png' },
      { index: 2, url: 'normalized:signed:images/location.png' },
    ])
  })

  it('still allows qwen storyboard sketch reference for square projects', async () => {
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
    mockImageUploads('cos/panel-qwen-square.png')
    utilsMock.uploadImageSourceToCosWithMetadata.mockReset()
    utilsMock.uploadImageSourceToCosWithMetadata.mockResolvedValueOnce({
      key: 'cos/panel-qwen-square.png',
      metadata: { mimeType: 'image/png', sizeBytes: 1024, width: 1024, height: 1024 },
    })

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: QWEN_STORYBOARD_MODEL,
        options: expect.objectContaining({
          referenceImages: [
            'normalized:signed:images/sketch.png',
          ],
          aspectRatio: '1:1',
        }),
        prompt: expect.stringContaining('参考图只用于辅助当前分镜的场景'),
      }),
    )
  })

  it('routes qwen storyboard location-only panels to text-to-image and blocks source-text characters', async () => {
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
    mockImageUploads('cos/panel-qwen-empty.png')

    await handlePanelImageTask(buildJob({
      candidateCount: 1,
      imageModel: QWEN_STORYBOARD_MODEL,
    }))

    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        source_text: 'hero is escorted by two nurses',
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
    mockImageUploads('cos/panel-three-character.png')

    const result = await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    expect(result).toEqual(expect.objectContaining({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: 'cos/panel-three-character.png',
    }))

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
