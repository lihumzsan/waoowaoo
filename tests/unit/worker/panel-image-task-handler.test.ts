import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const projectPanelUpdateMock = vi.hoisted(() => vi.fn(async () => ({})))

const prismaMock = vi.hoisted(() => ({
  projectPanel: {
    findUnique: vi.fn(),
    update: projectPanelUpdateMock,
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ storyboardModel: 'storyboard-model-1', artStyle: 'realistic' })),
  resolveImageSourceFromGeneration: vi.fn(async () => 'generated-source'),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => url || null),
  uploadImageSourceToCos: vi.fn(async (_source: string, _prefix: string, key: string) => `cos/${key}.png`),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelReferenceImageItemsWithDiagnostics: vi.fn(async () => ({
    items: [
      { url: 'https://signed.example/hero.png', role: 'character', name: 'Hero', appearance: 'default' },
      { url: 'https://signed.example/location.png', role: 'location', name: 'Old Town' },
    ],
    diagnostics: [],
    issues: [],
    expectedCharacterReferenceCount: 1,
  })),
  normalizeReferenceImageItemsForGeneration: vi.fn(async (
    items: ReadonlyArray<{ readonly url: string; readonly role: string; readonly name: string; readonly appearance?: string | null }>,
  ) => ({
    referenceImages: items.map((item) => `normalized:${item.url}`),
    referenceImagesMap: items.map((item, index) => ({
      image_no: `图 ${index + 1}`,
      role: item.role,
      name: item.name,
      ...(item.appearance ? { appearance: item.appearance } : {}),
    })),
  })),
  resolveNovelData: vi.fn(async () => ({ videoRatio: '16:9', characters: [], locations: [] })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
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
    collectPanelReferenceImageItemsWithDiagnostics: sharedMock.collectPanelReferenceImageItemsWithDiagnostics,
    normalizeReferenceImageItemsForGeneration: sharedMock.normalizeReferenceImageItemsForGeneration,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})

import { handlePanelImageTask } from '@/lib/workers/handlers/panel-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'panel-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-image-1',
      type: TASK_TYPE.IMAGE_PANEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectPanel',
      targetId,
      payload: {
        generationOptions: { aspectRatio: '16:9' },
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function panelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    shotType: 'close-up',
    cameraMove: 'static',
    description: 'hero close-up',
    imagePrompt: 'SCENE\nHero stands in the old town.',
    videoPrompt: 'video prompt',
    location: 'Old Town',
    characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
    srtSegment: 'source text',
    actingNotes: null,
    sketchImageUrl: null,
    imageUrl: null,
    imageMediaId: null,
    renderFactsJson: {
      SCENE: { name: 'Old Town', action: 'Hero stands in the old town.' },
      CHARACTERS: [{ name: 'Hero', visibility: 'visible' }],
      PROPS: [],
      CAMERA: { shotScale: 'close-up', lighting: 'soft light' },
      AXIS: { subjects: ['Hero'], screenDirection: 'Hero faces camera' },
      STYLE: { imageFilter: 'soft light' },
    },
    ...overrides,
  }
}

describe('worker panel-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectPanel.findUnique.mockResolvedValue(panelRow())
  })

  it('requires panel id explicitly', async () => {
    await expect(handlePanelImageTask(buildJob({}, ''))).rejects.toThrow('panelId missing')
  })

  it('uses persisted prompt and render facts without rebuilding from legacy panel fields', async () => {
    const result = await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    expect(result).toEqual({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: 'cos/panel-1-0.png',
    })
    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'storyboard-model-1',
      prompt: 'SCENE\nHero stands in the old town.',
      options: expect.objectContaining({
        aspectRatio: '16:9',
        referenceImages: [
          'normalized:https://signed.example/hero.png',
          'normalized:https://signed.example/location.png',
        ],
      }),
    }))
    expect(projectPanelUpdateMock).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        imageUrl: 'cos/panel-1-0.png',
        candidateImages: null,
      },
    })
  })

  it('compare-only mode exposes selected render facts and does not mutate the panel', async () => {
    const result = await handlePanelImageTask(buildJob({
      compareOnly: true,
      promptFieldOmissions: ['style_bible'],
    }))

    expect(result).toEqual(expect.objectContaining({
      panelId: 'panel-1',
      compareOnly: true,
      promptDebug: expect.objectContaining({
        omittedFields: ['style_bible'],
        prompt: expect.stringContaining('SCENE'),
        contextJson: expect.stringContaining('CHARACTERS'),
        sourceText: '',
        referenceImageCount: 2,
      }),
    }))
    expect(projectPanelUpdateMock).not.toHaveBeenCalled()
  })

  it('fails explicitly when render facts are missing', async () => {
    prismaMock.projectPanel.findUnique.mockResolvedValueOnce(panelRow({ renderFactsJson: null }))

    await expect(handlePanelImageTask(buildJob({ candidateCount: 1 }))).rejects.toThrow('PANEL_RENDER_FACTS_MISSING:panel-1')
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
  })
})
