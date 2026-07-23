import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

type AuthState = {
  authenticated: boolean
}

type SubmitResult = {
  taskId: string
  async: true
}

type RouteContext = {
  params: Promise<Record<string, string>>
}

type DirectRouteCase = {
  routeFile: string
  body: Record<string, unknown>
  params?: Record<string, string>
  expectedTaskType: TaskType
  expectedTargetType: string
  expectedProjectId: string
  expectedPayloadSubset?: Record<string, unknown>
  expectedSubmitEpisodeId?: string
}

type CapabilityGenerationOptionsInput = {
  runtimeSelections?: Record<string, unknown>
}

type CapabilityGenerationOptions = Record<string, string | number | boolean>

const authState = vi.hoisted<AuthState>(() => ({
  authenticated: true,
}))

const submitTaskMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<SubmitResult>>())

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'img::character',
    locationModel: 'img::location',
    editModel: 'img::edit',
  })),
  buildImageTaskPayloadFromUserConfig: vi.fn((input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
    generationOptions: { resolution: '1024x1024' },
  })),
  getProjectModelConfig: vi.fn(async () => ({
    characterModel: 'img::character',
    locationModel: 'img::location',
    editModel: 'img::edit',
    storyboardModel: 'img::storyboard',
    analysisModel: 'llm::analysis',
  })),
  buildImageTaskPayload: vi.fn(async (input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
    generationOptions: { resolution: '1024x1024' },
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async (
    input?: CapabilityGenerationOptionsInput,
  ): Promise<CapabilityGenerationOptions> => {
    void input
    return {
      resolution: '1024x1024',
    }
  }),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasGlobalCharacterOutput: vi.fn(async () => false),
  hasGlobalLocationOutput: vi.fn(async () => false),
  hasGlobalCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalLocationImageOutput: vi.fn(async () => false),
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
  hasPanelLipSyncOutput: vi.fn(async () => false),
  hasPanelImageOutput: vi.fn(async () => false),
  hasPanelVideoOutput: vi.fn(async () => false),
  hasVoiceLineAudioOutput: vi.fn(async () => false),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(async () => ({ lipSyncModel: 'fal::lipsync-model' })),
  },
  novelPromotionStoryboard: {
    findUnique: vi.fn(async () => ({
      id: 'storyboard-1',
      episode: {
        novelPromotionProject: {
          projectId: 'project-1',
        },
      },
    })),
    update: vi.fn(async () => ({})),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(async () => ({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'panel prompt',
      videoPromptEditedByUser: false,
      description: 'panel description',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [] as Array<{
        id: string
        content: string
        audioDuration: number
      }>,
    })),
    findMany: vi.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => []),
    findUnique: vi.fn(async ({ where }: { where?: { id?: string } }) => {
      const id = where?.id || 'panel-1'
      if (id === 'panel-src') {
        return {
          id,
          storyboardId: 'storyboard-1',
          panelIndex: 1,
          shotType: 'wide',
          cameraMove: 'static',
          description: 'source description',
          videoPrompt: 'source video prompt',
          location: 'source location',
          characters: '[]',
          srtSegment: '',
          duration: 3,
        }
      }
      if (id === 'panel-ins') {
        return {
          id,
          storyboardId: 'storyboard-1',
          panelIndex: 2,
          shotType: 'medium',
          cameraMove: 'push',
          description: 'insert description',
          videoPrompt: 'insert video prompt',
          location: 'insert location',
          characters: '[]',
          srtSegment: '',
          duration: 3,
        }
      }
      return {
        id,
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        shotType: 'medium',
        cameraMove: 'static',
        description: 'panel description',
        videoPrompt: 'panel prompt',
        location: 'panel location',
        characters: '[]',
        srtSegment: '',
        duration: 3,
      }
    }),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'panel-created', panelIndex: 3 })),
    findUniqueOrThrow: vi.fn(),
    delete: vi.fn(async () => ({})),
    count: vi.fn(async () => 3),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  novelPromotionProject: {
    findUnique: vi.fn(async () => ({
      id: 'project-data-1',
      characters: [
        { name: 'Narrator', customVoiceUrl: 'https://voice.example/narrator.mp3' },
      ],
    })),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({
      id: 'episode-1',
      speakerVoices: '{}',
    })),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn<(...args: unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => [
      { id: 'line-1', speaker: 'Narrator', content: 'hello world voice line', audioDuration: null as number | null },
    ]),
    findFirst: vi.fn(async () => ({
      id: 'line-1',
      speaker: 'Narrator',
      content: 'hello world voice line',
    })),
  },
  task: {
    findMany: vi.fn(async () => []),
  },
  $transaction: vi.fn(async (fn: (tx: {
    novelPromotionPanel: {
      findMany: (args: unknown) => Promise<Array<{ id: string; panelIndex: number }>>
      update: (args: unknown) => Promise<unknown>
      create: (args: { data?: { id?: string; panelIndex?: number } }) => Promise<{ id: string; panelIndex: number }>
      findFirst: (args: unknown) => Promise<{ panelIndex: number } | null>
      delete: (args: unknown) => Promise<unknown>
      count: (args: unknown) => Promise<number>
      updateMany: (args: unknown) => Promise<{ count: number }>
    }
    novelPromotionStoryboard: {
      update: (args: unknown) => Promise<unknown>
    }
  }) => Promise<unknown>) => {
    const tx = {
      novelPromotionPanel: {
        findMany: async () => [],
        update: async () => ({}),
        create: async (args: { data?: { id?: string; panelIndex?: number } }) => ({
          id: args.data?.id || 'panel-created',
          panelIndex: args.data?.panelIndex ?? 3,
        }),
        findFirst: async () => ({ panelIndex: 3 }),
        delete: async () => ({}),
        count: async () => 3,
        updateMany: async () => ({ count: 0 }),
      },
      novelPromotionStoryboard: {
        update: async () => ({}),
      },
    }
    return await fn(tx)
  }),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
  }
})

vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/providers/bailian/voice-design', () => ({
  validateVoicePrompt: vi.fn(() => ({ valid: true })),
  validatePreviewText: vi.fn(() => ({ valid: true })),
}))
vi.mock('@/lib/media/outbound-image', () => ({
  sanitizeImageInputsForTaskPayload: vi.fn((inputs: unknown[]) => ({
    normalized: inputs
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    issues: [] as Array<{ reason: string }>,
  })),
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn((_modelType: string, modelKey: string) => (
    modelKey.includes('seedance2/bernini-480p-i2v')
      ? {
          video: {
            firstlastframe: false,
            durationOptions: [5, 10],
            fpsOptions: [24],
          },
        }
      : { video: { firstlastframe: true } }
  )),
}))
vi.mock('@/lib/model-pricing/lookup', () => ({
  resolveBuiltinPricing: vi.fn(() => ({ status: 'ok' })),
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelection: vi.fn(async () => ({
    provider: 'fal',
    modelId: 'lip-model',
    modelKey: 'fal::lip-model',
    mediaType: 'lipsync',
  })),
  resolveModelSelectionOrSingle: vi.fn(async (_userId: string, model: string | null | undefined) => {
    const modelKey = typeof model === 'string' && model.trim().length > 0
      ? model.trim()
      : 'comfyui::baseaudio/单人/LongCat-one'
    const separator = modelKey.indexOf('::')
    const provider = separator === -1 ? modelKey : modelKey.slice(0, separator)
    const modelId = separator === -1 ? modelKey : modelKey.slice(separator + 2)
    return {
      provider,
      modelId,
      modelKey,
      mediaType: 'audio',
    }
  }),
  getConnectedModelsByType: vi.fn(async () => ([{
    provider: 'fal',
    modelId: 'lip-model',
    modelKey: 'fal::lip-model',
    type: 'lipsync',
    name: 'Kling Lip Sync',
    price: 0,
  }])),
  getProviderConfig: vi.fn(async () => ({
    id: 'fal',
    name: 'FAL',
    apiKey: 'fal-key',
  })),
  getProviderKey: vi.fn((providerId: string) => {
    const marker = providerId.indexOf(':')
    return marker === -1 ? providerId : providerId.slice(0, marker)
  }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

function toApiPath(routeFile: string, params?: Record<string, string>): string {
  return routeFile
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace('[projectId]', params?.projectId || 'project-1')
    .replace('[episodeId]', params?.episodeId || 'episode-1')
    .replace('[assetId]', params?.assetId || 'asset-1')
}

function toModuleImportPath(routeFile: string): string {
  return `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
}

const DIRECT_CASES: ReadonlyArray<DirectRouteCase> = [
  {
    routeFile: 'src/app/api/asset-hub/generate-image/route.ts',
    body: { type: 'character', id: 'global-character-1', appearanceIndex: 0, artStyle: 'realistic' },
    expectedTaskType: TASK_TYPE.ASSET_HUB_IMAGE,
    expectedTargetType: 'GlobalCharacter',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/asset-hub/modify-image/route.ts',
    body: {
      type: 'character',
      id: 'global-character-1',
      modifyPrompt: 'sharpen details',
      appearanceIndex: 0,
      imageIndex: 0,
      extraImageUrls: ['https://example.com/ref-a.png'],
    },
    expectedTaskType: TASK_TYPE.ASSET_HUB_MODIFY,
    expectedTargetType: 'GlobalCharacterAppearance',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/assets/[assetId]/generate/route.ts',
    body: {
      scope: 'global',
      kind: 'character',
      appearanceIndex: 0,
      artStyle: 'realistic',
    },
    params: { assetId: 'global-character-1' },
    expectedTaskType: TASK_TYPE.ASSET_HUB_IMAGE,
    expectedTargetType: 'GlobalCharacter',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/assets/[assetId]/generate/route.ts',
    body: {
      scope: 'project',
      kind: 'character',
      projectId: 'project-1',
      appearanceId: 'appearance-1',
    },
    params: { assetId: 'character-1' },
    expectedTaskType: TASK_TYPE.IMAGE_CHARACTER,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/assets/[assetId]/modify-render/route.ts',
    body: {
      scope: 'global',
      kind: 'character',
      modifyPrompt: 'sharpen details',
      appearanceIndex: 0,
      imageIndex: 0,
      extraImageUrls: ['https://example.com/ref-a.png'],
    },
    params: { assetId: 'global-character-1' },
    expectedTaskType: TASK_TYPE.ASSET_HUB_MODIFY,
    expectedTargetType: 'GlobalCharacterAppearance',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/assets/[assetId]/modify-render/route.ts',
    body: {
      scope: 'project',
      kind: 'character',
      projectId: 'project-1',
      appearanceId: 'appearance-1',
      modifyPrompt: 'enhance texture',
      extraImageUrls: ['https://example.com/ref-b.png'],
    },
    params: { assetId: 'character-1' },
    expectedTaskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/asset-hub/voice-design/route.ts',
    body: { voicePrompt: 'female calm narrator', previewText: '你好世界' },
    expectedTaskType: TASK_TYPE.ASSET_HUB_VOICE_DESIGN,
    expectedTargetType: 'GlobalAssetHubVoiceDesign',
    expectedProjectId: 'global-asset-hub',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/generate-image/route.ts',
    body: { type: 'character', id: 'character-1', appearanceId: 'appearance-1' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_CHARACTER,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/cover/route.ts',
    body: { locale: 'zh' },
    params: { projectId: 'project-1', episodeId: 'episode-1' },
    expectedTaskType: TASK_TYPE.IMAGE_EPISODE_COVER,
    expectedTargetType: 'NovelPromotionEpisode',
    expectedProjectId: 'project-1',
    expectedSubmitEpisodeId: 'episode-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
    body: {
      episodeId: 'stale-episode',
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      generationOptions: {
        resolution: '720p',
        duration: 5,
      },
      firstLastFrame: {
        flModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
        customPrompt: 'visible persisted transition prompt',
        customPromptEditedByUser: true,
      },
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VIDEO_PANEL,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
    expectedSubmitEpisodeId: 'episode-1',
    expectedPayloadSubset: {
      videoModel: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      generationOptions: {
        resolution: '720p',
        duration: 5,
      },
      firstLastFrame: {
        flModel: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
        customPrompt: 'visible persisted transition prompt',
        customPromptEditedByUser: true,
      },
    },
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/insert-panel/route.ts',
    body: { storyboardId: 'storyboard-1', insertAfterPanelId: 'panel-ins' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.INSERT_PANEL,
    expectedTargetType: 'NovelPromotionStoryboard',
    expectedProjectId: 'project-1',
    expectedPayloadSubset: {
      storyboardId: 'storyboard-1',
      insertAfterPanelId: 'panel-ins',
      userInput: '请根据前后镜头自动分析并插入一个自然衔接的新分镜。',
    },
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/lip-sync/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      voiceLineId: 'line-1',
      lipSyncModel: 'fal::lip-model',
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.LIP_SYNC,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/modify-asset-image/route.ts',
    body: {
      type: 'character',
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      modifyPrompt: 'enhance texture',
      extraImageUrls: ['https://example.com/ref-b.png'],
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/modify-storyboard-image/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      modifyPrompt: 'increase contrast',
      extraImageUrls: ['https://example.com/ref-c.png'],
      selectedAssets: [{ imageUrl: 'https://example.com/ref-d.png' }],
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/panel-variant/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      insertAfterPanelId: 'panel-ins',
      sourcePanelId: 'panel-src',
      variant: { video_prompt: 'new prompt', description: 'variant desc' },
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.PANEL_VARIANT,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-group/route.ts',
    body: { type: 'character', id: 'character-1', appearanceId: 'appearance-1' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.REGENERATE_GROUP,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-panel-image/route.ts',
    body: { panelId: 'panel-1', count: 1 },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_PANEL,
    expectedTargetType: 'NovelPromotionPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-single-image/route.ts',
    body: { type: 'character', id: 'character-1', appearanceId: 'appearance-1', imageIndex: 0 },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_CHARACTER,
    expectedTargetType: 'CharacterAppearance',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/regenerate-storyboard-text/route.ts',
    body: { storyboardId: 'storyboard-1' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.REGENERATE_STORYBOARD_TEXT,
    expectedTargetType: 'NovelPromotionStoryboard',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/voice-design/route.ts',
    body: { voicePrompt: 'warm female voice', previewText: 'This is preview text' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VOICE_DESIGN,
    expectedTargetType: 'NovelPromotionProject',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/novel-promotion/[projectId]/voice-generate/route.ts',
    body: { episodeId: 'episode-1', lineId: 'line-1', audioModel: 'comfyui::baseaudio/单人/LongCat-one' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VOICE_LINE,
    expectedTargetType: 'NovelPromotionVoiceLine',
    expectedProjectId: 'project-1',
  },
]

async function invokePostRoute(routeCase: DirectRouteCase): Promise<Response> {
  const modulePath = toModuleImportPath(routeCase.routeFile)
  const mod = await import(modulePath)
  const post = mod.POST as (request: Request, context?: RouteContext) => Promise<Response>
  const req = buildMockRequest({
    path: toApiPath(routeCase.routeFile, routeCase.params),
    method: 'POST',
    body: routeCase.body,
  })
  return await post(req, { params: Promise.resolve(routeCase.params || {}) })
}

describe('api contract - direct submit routes (behavior)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    let seq = 0
    submitTaskMock.mockImplementation(async () => ({
      taskId: `task-${++seq}`,
      async: true,
    }))
  })

  it('keeps expected coverage size', () => {
    expect(DIRECT_CASES.length).toBe(21)
  })

  for (const routeCase of DIRECT_CASES) {
    it(`${routeCase.routeFile} -> returns 401 when unauthenticated`, async () => {
      authState.authenticated = false
      const res = await invokePostRoute(routeCase)
      expect(res.status).toBe(401)
      expect(submitTaskMock).not.toHaveBeenCalled()
    })

    it(`${routeCase.routeFile} -> submits task with expected contract when authenticated`, async () => {
      const res = await invokePostRoute(routeCase)
      expect(res.status).toBe(200)
      expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
        type: routeCase.expectedTaskType,
        targetType: routeCase.expectedTargetType,
        projectId: routeCase.expectedProjectId,
        userId: 'user-1',
      }))

      const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
      expect(submitArg?.type).toBe(routeCase.expectedTaskType)
      expect(submitArg?.targetType).toBe(routeCase.expectedTargetType)
      expect(submitArg?.projectId).toBe(routeCase.expectedProjectId)
      expect(submitArg?.userId).toBe('user-1')
      if (routeCase.expectedSubmitEpisodeId) {
        expect(submitArg?.episodeId).toBe(routeCase.expectedSubmitEpisodeId)
      }
      if (routeCase.expectedPayloadSubset) {
        expect(submitArg?.payload).toEqual(expect.objectContaining(routeCase.expectedPayloadSubset))
      }

      const json = await res.json() as Record<string, unknown>
      const isVoiceGenerateRoute = routeCase.routeFile.endsWith('/voice-generate/route.ts')
      if (isVoiceGenerateRoute) {
        expect(json.success).toBe(true)
        expect(json.async).toBe(true)
        expect(typeof json.taskId).toBe('string')
      } else {
        expect(json.async).toBe(true)
        expect(typeof json.taskId).toBe('string')
      }
    })
  }

  it('blocks removed legacy LTX2.3 generate-video model keys', async () => {
    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        locale: 'zh',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        videoModel: 'comfyui::basevideo/demo/LTX2.3-fast',
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error?.details?.code || json.error?.code || json.code).toBe('LEGACY_LTX23_WORKFLOW_REMOVED')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('ignores stale nested relation voice lines and queries relation lines from the panel episode', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'panel prompt',
      videoPromptEditedByUser: false,
      description: 'panel description',
      srtSegment: 'short dialogue',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [
        {
          id: 'stale-line-1',
          content: 'This stale nested relation belongs to another episode.',
          audioDuration: 23_700,
        },
      ],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 12,
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeId: 'episode-1',
        matchedPanelId: 'panel-1',
      },
    }))
    expect(res.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.VIDEO_PANEL,
      targetId: 'panel-1',
      episodeId: 'episode-1',
    }))
  })

  it('batch generate-video resolves readiness voice lines with batched relation/fallback/explicit queries', async () => {
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-a',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        imageUrl: 'cos/panel-a.png',
        videoPrompt: 'panel a prompt',
        videoPromptEditedByUser: false,
        description: 'panel a description',
        srtSegment: 'short dialogue a',
        videoDurationBinding: null,
        shotType: 'medium',
        cameraMove: 'static',
        sceneType: 'dialogue',
        storyboard: {
          episodeId: 'episode-1',
          clip: {
            content: 'office conversation',
          },
        },
      },
      {
        id: 'panel-b',
        storyboardId: 'storyboard-1',
        panelIndex: 1,
        imageUrl: 'cos/panel-b.png',
        videoPrompt: 'panel b prompt',
        videoPromptEditedByUser: false,
        description: 'panel b description',
        srtSegment: 'short dialogue b',
        videoDurationBinding: null,
        shotType: 'medium',
        cameraMove: 'static',
        sceneType: 'dialogue',
        storyboard: {
          episodeId: 'episode-1',
          clip: {
            content: 'office conversation',
          },
        },
      },
    ])
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([
        {
          id: 'relation-line-a',
          content: 'short relation line',
          audioDuration: 1200,
          lineIndex: 0,
          matchedPanelId: 'panel-a',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'fallback-line-b',
          content: 'short fallback line',
          audioDuration: 1300,
          lineIndex: 1,
          matchedStoryboardId: 'storyboard-1',
          matchedPanelIndex: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'explicit-line-1',
          content: 'short explicit line',
          audioDuration: 900,
          lineIndex: 2,
        },
      ])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        all: true,
        episodeId: 'episode-1',
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['explicit-line-1'],
        },
        generationOptions: {
          duration: 12,
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledTimes(3)
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        episodeId: { in: ['episode-1'] },
        matchedPanelId: { in: ['panel-a', 'panel-b'] },
      },
    }))
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        episodeId: { in: ['episode-1'] },
        matchedPanelId: null,
        OR: [
          { matchedStoryboardId: 'storyboard-1', matchedPanelIndex: 0 },
          { matchedStoryboardId: 'storyboard-1', matchedPanelIndex: 1 },
        ],
      },
    }))
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: {
        id: { in: ['explicit-line-1'] },
        episodeId: { in: ['episode-1'] },
      },
    }))
    expect(submitTaskMock).toHaveBeenCalledTimes(2)
  })

  it('single generate-video auto-routes current Smart VBVR large-motion prompts before submit', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: '男子突然转身奔跑，镜头跟拍并逐渐推近',
      videoPromptEditedByUser: false,
      description: '男子突然转身奔跑，镜头跟拍并逐渐推近',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: '跟拍推近',
      sceneType: 'action',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 6,
          resolution: '720p',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
      generationOptions: expect.objectContaining({
        duration: 12,
        resolution: '720p',
      }),
      ltx23WorkflowRouting: expect.objectContaining({
        selectedWorkflowKey: 'basevideo/ltx23-profiles/t8-single-image-large-motion-4stage',
        reasons: expect.arrayContaining(['large_motion_or_camera_movement']),
      }),
    }))
  })

  it('single generate-video uses smart first-last duration binding above stale dropdown duration', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'first frame characters walk toward a glowing terminal',
      videoPromptEditedByUser: false,
      description: 'first frame characters walk toward a glowing terminal',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'push in',
      sceneType: 'action',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'fantasy transition',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 10,
          resolution: '720p',
        },
        videoDurationBinding: {
          mode: 'manual',
          targetDurationSeconds: 8,
          recommendedDurationSeconds: 8,
          durationSource: 'smart',
          recommendationFingerprint: 'smart-fp',
        },
        firstLastFrame: {
          flModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
          lastFrameStoryboardId: 'storyboard-1',
          lastFramePanelIndex: 1,
          customPrompt: 'visible first-last transition prompt',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      generationOptions: expect.objectContaining({
        duration: 8,
        resolution: '720p',
      }),
      videoDurationBinding: expect.objectContaining({
        targetDurationSeconds: 8,
        durationSource: 'smart',
      }),
      firstLastFrame: expect.objectContaining({
        flModel: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      }),
    }))
  })

  it('single generate-video keeps manual first-last duration binding above smart recommendation metadata', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'manual first-last bridge',
      videoPromptEditedByUser: false,
      description: 'manual first-last bridge',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'push in',
      sceneType: 'action',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'fantasy transition',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
        videoDurationBinding: {
          mode: 'manual',
          targetDurationSeconds: 6,
          recommendedDurationSeconds: 8,
          durationSource: 'manual',
          recommendationFingerprint: 'smart-fp',
          recommendationReason: 'smart suggested longer motion',
        },
        firstLastFrame: {
          flModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
          lastFrameStoryboardId: 'storyboard-1',
          lastFramePanelIndex: 1,
          customPrompt: 'visible first-last transition prompt',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/ltx23-profiles/goon-first-last-frame-2stage',
      generationOptions: expect.objectContaining({
        duration: 6,
        resolution: '720p',
      }),
      videoDurationBinding: expect.objectContaining({
        targetDurationSeconds: 6,
        durationSource: 'manual',
        recommendedDurationSeconds: 8,
      }),
    }))
  })

  it('single generate-video normalizes the Bernini audio lipsync key and stale fps before submit', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'doctor speaks in a static close-up',
      videoPromptEditedByUser: false,
      description: 'doctor speaks in a static close-up',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'close',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (
      input?: CapabilityGenerationOptionsInput & { modelKey?: string },
    ): Promise<CapabilityGenerationOptions> => {
      expect(input?.modelKey).toBe('comfyui::basevideo/seedance2/bernini-480p-i2v')
      expect(input?.runtimeSelections).toEqual(expect.objectContaining({
        duration: 5,
        fps: 24,
        resolution: '480p',
        generationMode: 'normal',
        motionStrength: 2,
      }))
      return {
        duration: 5,
        fps: 24,
        resolution: '480p',
        generationMode: 'normal',
        motionStrength: 2,
      }
    })

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v-audio-lipsync',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 5,
          fps: 25,
          resolution: '480p',
          motionStrength: 2,
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
      generationOptions: expect.objectContaining({
        duration: 5,
        fps: 24,
        resolution: '480p',
        motionStrength: 2,
      }),
    }))
  })

  it('single generate-video accepts an exact Bernini card duration outside the catalog presets', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 5,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'a glowing will reaches toward the bright point',
      videoPromptEditedByUser: false,
      description: 'a glowing will reaches toward the bright point',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'push in',
      sceneType: 'action',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'fantasy negotiation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    let capabilityInput: (CapabilityGenerationOptionsInput & { modelKey?: string }) | undefined
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (
      input?: CapabilityGenerationOptionsInput & { modelKey?: string },
    ): Promise<CapabilityGenerationOptions> => {
      capabilityInput = input
      return {
        duration: 10,
        fps: 24,
        resolution: '480p',
        generationMode: 'normal',
        motionStrength: 1,
      }
    })

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
        storyboardId: 'storyboard-1',
        panelIndex: 5,
        generationOptions: {
          duration: 6,
          generationMode: 'normal',
          fps: 24,
          resolution: '480p',
          motionStrength: 1,
        },
        videoDurationBinding: {
          mode: 'manual',
          voiceLineIds: [],
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    expect(capabilityInput?.modelKey).toBe('comfyui::basevideo/seedance2/bernini-480p-i2v')
    expect(capabilityInput?.runtimeSelections).toEqual(expect.objectContaining({
      duration: 10,
      fps: 24,
      resolution: '480p',
      generationMode: 'normal',
      motionStrength: 1,
    }))
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
      generationOptions: expect.objectContaining({
        duration: 6,
        fps: 24,
        resolution: '480p',
        motionStrength: 1,
      }),
    }))
  })

  it('single generate-video accepts an exact KJ recommended duration above the catalog presets', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 5,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'a glowing will reaches toward the bright point',
      videoPromptEditedByUser: false,
      description: 'a glowing will reaches toward the bright point',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'push in',
      sceneType: 'action',
      storyboard: {
        episodeId: 'episode-1',
        clip: { content: 'fantasy negotiation' },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    let capabilityInput: (CapabilityGenerationOptionsInput & { modelKey?: string }) | undefined
    configServiceMock.resolveProjectModelCapabilityGenerationOptions.mockImplementationOnce(async (
      input?: CapabilityGenerationOptionsInput & { modelKey?: string },
    ): Promise<CapabilityGenerationOptions> => {
      capabilityInput = input
      return {
        duration: 20,
        fps: 25,
        resolution: '720p',
        generationMode: 'normal',
        motionStrength: 1,
      }
    })

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
        storyboardId: 'storyboard-1',
        panelIndex: 5,
        generationOptions: {
          duration: 21,
          generationMode: 'normal',
          fps: 25,
          resolution: '720p',
          motionStrength: 1,
        },
        videoDurationBinding: {
          mode: 'manual',
          voiceLineIds: [],
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    expect(capabilityInput?.runtimeSelections).toEqual(expect.objectContaining({
      duration: 20,
      fps: 25,
      resolution: '720p',
      generationMode: 'normal',
      motionStrength: 1,
    }))
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p',
      generationOptions: expect.objectContaining({
        duration: 21,
        fps: 25,
        resolution: '720p',
        motionStrength: 1,
      }),
    }))
  })

  it('single generate-video keeps slow locked camera prompts on current Smart VBVR', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: '\u60e8\u767d\u767d\u70bd\u706f\u5782\u5728\u591c\u95f4\u529e\u516c\u5ba4\u4e2d\u592e\uff0c\u4e2d\u5e74\u7537\u5b50\u5750\u5728\u4e66\u684c\u540e\u4fa7\u9760\u5899\u7684\u6905\u5b50\u4e0a\u5fae\u5fae\u524d\u503e\uff0c\u5e74\u8f7b\u7537\u5b50\u5750\u5728\u4e66\u684c\u524d\u4fa7\u9762\u5411\u4e66\u684c\u7684\u6905\u5b50\u4e0a\u62ac\u773c\u5bf9\u89c6\uff0c\u56db\u5468\u7a7a\u5899\u548c\u6697\u89d2\u538b\u4f4f\u7a7a\u95f4\uff0c\u955c\u5934\u7f13\u6162\u63a8\u8fdb\u4fef\u62cd',
      videoPromptEditedByUser: false,
      description: '\u8fdc\u666f\uff1a\u4e24\u4eba\u9694\u7740\u4e66\u684c\u5bf9\u89c6\uff0c\u7a7a\u5899\u548c\u6697\u89d2\u538b\u4f4f\u7a7a\u95f4',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: '\u4fef\u62cd\u8fdc\u666f',
      cameraMove: '\u7f13\u6162\u63a8\u8fdb',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 4,
          resolution: '720p',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      generationOptions: expect.objectContaining({
        duration: 12,
        resolution: '720p',
      }),
      ltx23WorkflowRouting: expect.objectContaining({
        selectedWorkflowKey: 'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        reasons: expect.arrayContaining(['slow_stable_camera_movement']),
      }),
    }))
    expect(submitArg?.payload).not.toHaveProperty('firstLastFrame')
  })

  it('single generate-video normalizes stale first-last-frame-only LTX2.3 model in normal mode', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'two people sit still in an office',
      videoPromptEditedByUser: false,
      description: 'two people sit still in an office',
      srtSegment: '',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 6,
          resolution: '720p',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(200)
    const submitArg = submitTaskMock.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(submitArg?.payload).toEqual(expect.objectContaining({
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      generationOptions: expect.objectContaining({
        duration: 6,
        resolution: '720p',
      }),
      ltx23WorkflowRouting: expect.objectContaining({
        selectedModelKey: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        reasons: expect.arrayContaining(['first_last_frame_model_in_normal_mode']),
      }),
    }))
    expect(submitArg?.payload).not.toHaveProperty('firstLastFrame')
  })

  it('single generate-video blocks Smart VBVR long-audio requests instead of routing away', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'doctor listens in a continuous single shot',
      videoPromptEditedByUser: false,
      description: 'doctor listens in a continuous single shot',
      srtSegment: 'long dialogue',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([
        {
          id: 'line-1',
          content: 'This relation line should push the router to the long-video profile.',
          audioDuration: 23_700,
        },
      ])
      .mockResolvedValueOnce([])
    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        generationOptions: {
          duration: 6,
          resolution: '720p',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { code?: string; details?: { issue?: { code?: string } } }
    expect(body.code).toBe('VIDEO_READINESS_BLOCKED')
    expect(body.details?.issue?.code).toBe('audio_duration_exceeds_model')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('batch generate-video validates all ready panels before submitting any task', async () => {
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-a',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        imageUrl: 'cos/panel-a.png',
        videoPrompt: 'panel a prompt',
        videoPromptEditedByUser: false,
        description: 'panel a description',
        srtSegment: '',
        videoDurationBinding: null,
        shotType: 'medium',
        cameraMove: 'static',
        sceneType: 'dialogue',
        storyboard: {
          episodeId: 'episode-1',
          clip: { content: 'office conversation' },
        },
      },
      {
        id: 'panel-b',
        storyboardId: 'storyboard-1',
        panelIndex: 1,
        imageUrl: 'cos/panel-b.png',
        videoPrompt: 'panel b prompt',
        videoPromptEditedByUser: false,
        description: 'panel b description',
        srtSegment: '',
        videoDurationBinding: null,
        shotType: 'medium',
        cameraMove: 'static',
        sceneType: 'dialogue',
        storyboard: {
          episodeId: 'episode-1',
          clip: { content: 'office conversation' },
        },
      },
    ])
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    configServiceMock.resolveProjectModelCapabilityGenerationOptions
      .mockResolvedValueOnce({ resolution: '720p' })
      .mockRejectedValueOnce(new Error('unsupported generated capability combination'))

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        all: true,
        episodeId: 'episode-1',
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('blocks single generate-video submission when episode-filtered relation audio exceeds the selected LTX workflow max', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'panel prompt',
      videoPromptEditedByUser: false,
      description: 'panel description',
      srtSegment: 'long dialogue',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [],
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([
        {
          id: 'line-1',
          speaker: 'Narrator',
          content: 'This long line cannot fit the short workflow.',
          audioDuration: 23_884,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        ltx23WorkflowSelection: 'manual',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['line-1'],
        },
        generationOptions: {
          duration: 12,
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeId: 'episode-1',
        matchedPanelId: 'panel-1',
      },
    }))
    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({
      error: {
        details: {
          code: 'VIDEO_READINESS_BLOCKED',
          field: 'videoDurationBinding',
          details: {
            issue: {
              code: 'audio_duration_exceeds_model',
            },
          },
        },
      },
    })
  })

  it('blocks single generate-video submission using fallback storyboard-bound voice lines from the panel episode', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'panel prompt',
      videoPromptEditedByUser: false,
      description: 'panel description',
      srtSegment: 'long dialogue',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [] as Array<{
        id: string
        content: string
        audioDuration: number
      }>,
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'fallback-line-1',
          speaker: 'Narrator',
          content: 'This fallback line cannot fit the short workflow.',
          audioDuration: 23_700,
        },
      ])
      .mockResolvedValueOnce([])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        episodeId: 'stale-episode',
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        ltx23WorkflowSelection: 'manual',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['fallback-line-1'],
        },
        generationOptions: {
          duration: 12,
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeId: 'episode-1',
        matchedPanelId: null,
        matchedStoryboardId: 'storyboard-1',
        matchedPanelIndex: 0,
      },
    }))
    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({
      error: {
        details: {
          code: 'VIDEO_READINESS_BLOCKED',
          field: 'videoDurationBinding',
          details: {
            issue: {
              code: 'audio_duration_exceeds_model',
            },
          },
        },
      },
    })
  })

  it('blocks single generate-video submission using explicitly selected voice lines from the panel episode', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel.png',
      videoUrl: 'cos/video.mp4',
      videoPrompt: 'panel prompt',
      videoPromptEditedByUser: false,
      description: 'panel description',
      srtSegment: 'long dialogue',
      videoDurationBinding: null,
      shotType: 'medium',
      cameraMove: 'static',
      sceneType: 'dialogue',
      storyboard: {
        episodeId: 'episode-1',
        clip: {
          content: 'office conversation',
        },
      },
      matchedVoiceLines: [] as Array<{
        id: string
        content: string
        audioDuration: number
      }>,
    })
    prismaMock.novelPromotionVoiceLine.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'explicit-line-1',
          speaker: 'Narrator',
          content: 'This explicitly selected line cannot fit the short workflow.',
          audioDuration: 23_700,
        },
      ])

    const res = await invokePostRoute({
      routeFile: 'src/app/api/novel-promotion/[projectId]/generate-video/route.ts',
      body: {
        episodeId: 'stale-episode',
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        ltx23WorkflowSelection: 'manual',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['explicit-line-1'],
        },
        generationOptions: {
          duration: 12,
        },
      },
      params: { projectId: 'project-1' },
      expectedTaskType: TASK_TYPE.VIDEO_PANEL,
      expectedTargetType: 'NovelPromotionPanel',
      expectedProjectId: 'project-1',
    })

    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ['explicit-line-1'] },
        episodeId: 'episode-1',
      },
    }))
    expect(res.status).toBe(400)
    expect(submitTaskMock).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({
      error: {
        details: {
          code: 'VIDEO_READINESS_BLOCKED',
          field: 'videoDurationBinding',
          details: {
            issue: {
              code: 'audio_duration_exceeds_model',
            },
          },
        },
      },
    })
  })
})
