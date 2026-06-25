import { vi } from 'vitest'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

export type SubmitResult = {
  success: true
  taskId: string
  async: true
  status: 'queued'
  runId: null
  deduped: false
}

export type RouteContext = {
  params: Promise<Record<string, string>>
}

export type DirectRouteCase = {
  routeFile: string
  body: Record<string, unknown>
  params?: Record<string, string>
  expectedTaskType: TaskType
  expectedTargetType: string
  expectedProjectId: string
  expectedPayloadSubset?: Record<string, unknown>
}

export const authState = {
  authenticated: true,
}

export const submitTaskMock = vi.fn<(...args: unknown[]) => Promise<SubmitResult>>()
export const executeProjectAgentOperationFromApiMock = vi.fn<
  (params: {
    operationId: string
    projectId: string
    userId: string
    input: unknown
  }) => Promise<Record<string, unknown>>
>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function inferTaskContractFromOperation(params: {
  operationId: string
  projectId: string
  input: unknown
}): { type: TaskType; targetType: string; targetId: string } {
  const input = isRecord(params.input) ? params.input : {}

  switch (params.operationId) {
    case 'api_assets_generate':
      return input.scope === 'project'
        ? {
          type: input.kind === 'location' ? TASK_TYPE.IMAGE_LOCATION : TASK_TYPE.IMAGE_CHARACTER,
          targetType: input.kind === 'location' ? 'ProjectLocation' : 'CharacterAppearance',
          targetId: typeof input.assetId === 'string' ? input.assetId : 'asset-1',
        }
        : {
          type: TASK_TYPE.ASSET_HUB_IMAGE,
          targetType: input.kind === 'location' ? 'GlobalLocation' : 'GlobalCharacterAppearance',
          targetId: typeof input.appearanceId === 'string'
            ? input.appearanceId
            : typeof input.assetId === 'string'
              ? input.assetId
              : 'asset-1',
        }
    case 'api_assets_modify_render':
      return input.scope === 'project'
        ? {
          type: TASK_TYPE.MODIFY_ASSET_IMAGE,
          targetType: input.kind === 'location' ? 'ProjectLocation' : 'CharacterAppearance',
          targetId: typeof input.assetId === 'string' ? input.assetId : 'asset-1',
        }
        : {
          type: TASK_TYPE.ASSET_HUB_MODIFY,
          targetType: input.kind === 'location' ? 'GlobalLocationImage' : 'GlobalCharacterAppearance',
          targetId: typeof input.assetId === 'string' ? input.assetId : 'asset-1',
        }
    case 'generate_character_image':
      return {
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: typeof input.characterId === 'string' ? input.characterId : 'character-1',
      }
    case 'generate_location_image':
      return {
        type: TASK_TYPE.IMAGE_LOCATION,
        targetType: 'ProjectLocation',
        targetId: typeof input.locationId === 'string' ? input.locationId : 'location-1',
      }
    case 'generate_panel_video':
    case 'generate_episode_videos':
      return {
        type: TASK_TYPE.VIDEO_PANEL,
        targetType: 'ProjectPanel',
        targetId: typeof input.panelId === 'string' ? input.panelId : 'panel-1',
      }
    case 'generate_project_music':
      return {
        type: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: params.projectId,
      }
    case 'generate_episode_bgm_score':
      return {
        type: TASK_TYPE.BGM_SCORE_GENERATE,
        targetType: 'ProjectEpisode',
        targetId: typeof input.episodeId === 'string' ? input.episodeId : 'episode-1',
      }
    case 'modify_character_image':
      return {
        type: TASK_TYPE.MODIFY_ASSET_IMAGE,
        targetType: 'CharacterAppearance',
        targetId: typeof input.characterId === 'string' ? input.characterId : 'character-1',
      }
    case 'modify_location_image':
      return {
        type: TASK_TYPE.MODIFY_ASSET_IMAGE,
        targetType: 'ProjectLocation',
        targetId: typeof input.locationId === 'string' ? input.locationId : 'location-1',
      }
    case 'modify_storyboard_image':
      return {
        type: TASK_TYPE.MODIFY_ASSET_IMAGE,
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
      }
    case 'regenerate_group':
      return {
        type: TASK_TYPE.REGENERATE_GROUP,
        targetType: input.type === 'location' ? 'ProjectLocation' : 'CharacterAppearance',
        targetId: typeof input.id === 'string' ? input.id : 'asset-1',
      }
    case 'regenerate_panel_image':
      return {
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: typeof input.panelId === 'string' ? input.panelId : 'panel-1',
      }
    case 'regenerate_single_image':
      return {
        type: input.type === 'location' ? TASK_TYPE.IMAGE_LOCATION : TASK_TYPE.IMAGE_CHARACTER,
        targetType: input.type === 'location' ? 'ProjectLocation' : 'CharacterAppearance',
        targetId: typeof input.id === 'string' ? input.id : 'asset-1',
      }
    case 'insert_storyboard_panel':
      return {
        type: TASK_TYPE.INSERT_PANEL,
        targetType: 'ProjectStoryboard',
        targetId: typeof input.storyboardId === 'string' ? input.storyboardId : 'storyboard-1',
      }
    case 'panel_variant':
      return {
        type: TASK_TYPE.PANEL_VARIANT,
        targetType: 'ProjectStoryboard',
        targetId: typeof input.storyboardId === 'string' ? input.storyboardId : 'storyboard-1',
      }
    default:
      throw new Error(`UNMOCKED_OPERATION:${params.operationId}`)
  }
}

export const configServiceMock = {
  getUserModelConfig: vi.fn(async () => ({
    analysisModel: 'llm::analysis',
    characterModel: 'img::character',
    locationModel: 'img::location',
    storyboardModel: 'img::storyboard',
    editModel: 'img::edit',
  })),
  buildImageBillingPayloadFromUserConfig: vi.fn((input: {
    imageModel: string | null
    basePayload: Record<string, unknown>
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
    generationOptions: { resolution: '1024x1024' },
  })),
  getProjectModelConfig: vi.fn(async () => ({
    characterModel: 'img::character',
    locationModel: 'img::location',
    editModel: 'img::edit',
    storyboardModel: 'img::storyboard',
    analysisModel: 'llm::analysis',
  })),
  buildImageBillingPayload: vi.fn(async (input: { basePayload: Record<string, unknown> }) => ({
    ...input.basePayload,
    generationOptions: { resolution: '1024x1024' },
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({
    resolution: '1024x1024',
  })),
}

export const hasOutputMock = {
  hasGlobalCharacterOutput: vi.fn(async () => false),
  hasGlobalLocationOutput: vi.fn(async () => false),
  hasGlobalCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalLocationImageOutput: vi.fn(async () => false),
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
  hasPanelImageOutput: vi.fn(async () => false),
  hasPanelVideoOutput: vi.fn(async () => false),
}

export const prismaMock = {
  project: {
    findUnique: vi.fn(async () => ({
      id: 'project-1',
      musicModel: 'google::lyria-3-clip-preview',
      artStyle: 'american-comic',
      visualStylePresetSource: 'system',
      visualStylePresetId: 'american-comic',
      characters: [{ name: 'Narrator' }],
    })),
  },
  userPreference: {
    findUnique: vi.fn(async () => ({ musicModel: 'google::lyria-3-clip-preview' })),
  },
  projectStoryboard: {
    findFirst: vi.fn(async () => ({ id: 'storyboard-1' })),
    findUnique: vi.fn(async () => ({
      id: 'storyboard-1',
      episode: {
        projectId: 'project-1',
      },
    })),
    update: vi.fn(async () => ({})),
  },
  projectPanel: {
    findFirst: vi.fn(async () => ({ id: 'panel-1' })),
    findMany: vi.fn(async () => []),
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
  projectEpisode: {
    findFirst: vi.fn(async () => ({
      id: 'episode-1',
      editScript: { durationSec: 30 },
    })),
  },
  projectEpisodeFinalOutput: {
    findUnique: vi.fn(async () => ({
      bgmScoreJson: {
        schemaVersion: 2,
        status: 'completed',
        mix: {
          mediaId: 'media-bgm',
          url: '/m/bgm.m4a',
          storageKey: 'music/bgm.m4a',
          mimeType: 'audio/mp4',
          durationMs: 30000,
        },
      },
    })),
  },
  $transaction: vi.fn(async (fn: (tx: {
    projectPanel: {
      findMany: (args: unknown) => Promise<Array<{ id: string; panelIndex: number }>>
      update: (args: unknown) => Promise<unknown>
      create: (args: { data?: { id?: string; panelIndex?: number } }) => Promise<{ id: string; panelIndex: number }>
      findFirst: (args: unknown) => Promise<{ panelIndex: number } | null>
      delete: (args: unknown) => Promise<unknown>
      count: (args: unknown) => Promise<number>
      updateMany: (args: unknown) => Promise<{ count: number }>
    }
    projectStoryboard: {
      update: (args: unknown) => Promise<unknown>
    }
  }) => Promise<unknown>) => {
    const tx = {
      projectPanel: {
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
      projectStoryboard: {
        update: async () => ({}),
      },
    }
    return await fn(tx)
  }),
}

export function resetDirectSubmitMocks() {
  vi.clearAllMocks()
  authState.authenticated = true
  let seq = 0
  submitTaskMock.mockImplementation(async () => ({
    success: true,
    taskId: `task-${++seq}`,
    async: true,
    status: 'queued',
    runId: null,
    deduped: false,
  }))
  executeProjectAgentOperationFromApiMock.mockImplementation(async (params) => {
    const contract = inferTaskContractFromOperation({
      operationId: params.operationId,
      projectId: params.projectId,
      input: params.input,
    })
    const task = await submitTaskMock({
      userId: params.userId,
      projectId: params.projectId,
      type: contract.type,
      targetType: contract.targetType,
      targetId: contract.targetId,
      payload: params.input,
    })

    return task
  })
}

function toApiPath(routeFile: string, params?: Record<string, string>): string {
  return routeFile
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace('[projectId]', params?.projectId || 'project-1')
    .replace('[assetId]', params?.assetId || 'asset-1')
}

function toModuleImportPath(routeFile: string): string {
  return `@/${routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
}

export async function invokePostRoute(routeCase: DirectRouteCase): Promise<Response> {
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

export const DIRECT_MEDIA_CASES: ReadonlyArray<DirectRouteCase> = [
  {
    routeFile: 'src/app/api/assets/[assetId]/generate/route.ts',
    body: {
      scope: 'global',
      kind: 'character',
      appearanceId: 'appearance-1',
      appearanceIndex: 0,
    },
    params: { assetId: 'global-character-1' },
    expectedTaskType: TASK_TYPE.ASSET_HUB_IMAGE,
    expectedTargetType: 'GlobalCharacterAppearance',
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
    routeFile: 'src/app/api/projects/[projectId]/generate-video/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      generationOptions: {
        resolution: '720p',
        duration: 5,
      },
      firstLastFrame: {
        lastFrameStoryboardId: 'storyboard-1',
        lastFramePanelIndex: 1,
      },
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.VIDEO_PANEL,
    expectedTargetType: 'ProjectPanel',
    expectedProjectId: 'project-1',
    expectedPayloadSubset: {
      generationOptions: {
        resolution: '720p',
        duration: 5,
      },
      firstLastFrame: {
        lastFrameStoryboardId: 'storyboard-1',
        lastFramePanelIndex: 1,
      },
    },
  },
  {
    routeFile: 'src/app/api/projects/[projectId]/generate-music/route.ts',
    body: {
      musicModel: 'google::lyria-3-clip-preview',
      prompt: 'tense city chase score',
      durationSeconds: 30,
      vocalMode: 'instrumental',
      outputFormat: 'mp3',
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.MUSIC_GENERATE,
    expectedTargetType: 'Project',
    expectedProjectId: 'project-1',
    expectedPayloadSubset: {
      musicModel: 'google::lyria-3-clip-preview',
      prompt: 'tense city chase score',
      durationSeconds: 30,
      vocalMode: 'instrumental',
      outputFormat: 'mp3',
    },
  },
  {
    routeFile: 'src/app/api/projects/[projectId]/generate-bgm/route.ts',
    body: {
      confirmed: true,
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-clip-preview',
      outputFormat: 'mp3',
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.BGM_SCORE_GENERATE,
    expectedTargetType: 'ProjectEpisode',
    expectedProjectId: 'project-1',
    expectedPayloadSubset: {
      episodeId: 'episode-1',
      musicModel: 'google::lyria-3-clip-preview',
      outputFormat: 'mp3',
    },
  },
  {
    routeFile: 'src/app/api/projects/[projectId]/modify-storyboard-image/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      modifyPrompt: 'increase contrast',
      extraImageUrls: ['https://example.com/ref-c.png'],
      selectedAssets: [{ imageUrl: 'https://example.com/ref-d.png' }],
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.MODIFY_ASSET_IMAGE,
    expectedTargetType: 'ProjectPanel',
    expectedProjectId: 'project-1',
  },
  {
    routeFile: 'src/app/api/projects/[projectId]/regenerate-panel-image/route.ts',
    body: { panelId: 'panel-1', count: 1 },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.IMAGE_PANEL,
    expectedTargetType: 'ProjectPanel',
    expectedProjectId: 'project-1',
  },
]

export const DIRECT_TEXT_CASES: ReadonlyArray<DirectRouteCase> = []

export const DIRECT_RUN_CASES: ReadonlyArray<DirectRouteCase> = [
  {
    routeFile: 'src/app/api/projects/[projectId]/insert-panel/route.ts',
    body: { storyboardId: 'storyboard-1', insertAfterPanelId: 'panel-ins' },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.INSERT_PANEL,
    expectedTargetType: 'ProjectStoryboard',
    expectedProjectId: 'project-1',
    expectedPayloadSubset: {
      storyboardId: 'storyboard-1',
      insertAfterPanelId: 'panel-ins',
      userInput: '请根据前后镜头自动分析并插入一个自然衔接的新分镜。',
    },
  },
  {
    routeFile: 'src/app/api/projects/[projectId]/panel-variant/route.ts',
    body: {
      storyboardId: 'storyboard-1',
      insertAfterPanelId: 'panel-ins',
      sourcePanelId: 'panel-src',
      variant: { video_prompt: 'new prompt', description: 'variant desc' },
    },
    params: { projectId: 'project-1' },
    expectedTaskType: TASK_TYPE.PANEL_VARIANT,
    expectedTargetType: 'ProjectPanel',
    expectedProjectId: 'project-1',
  },
]
