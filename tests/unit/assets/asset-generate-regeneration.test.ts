import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { TASK_TYPE } from '@/lib/task/types'
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    characterModel: 'image::character-1' as string | null,
    locationModel: 'image::location-1' as string | null,
    storyboardModel: null as string | null,
    editModel: null as string | null,
    videoModel: null as string | null,
    audioModel: null as string | null,
    analysisModel: null as string | null,
    videoRatio: '16:9',
    artStyle: 'realistic',
    capabilityDefaults: {},
    capabilityOverrides: {},
  })),
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'image::character-1' as string | null,
    locationModel: 'image::location-1' as string | null,
    storyboardModel: null as string | null,
    editModel: null as string | null,
    videoModel: null as string | null,
    audioModel: null as string | null,
    analysisModel: null as string | null,
    voiceDesignModel: null as string | null,
    capabilityDefaults: {},
  })),
  buildImageTaskPayload: vi.fn(async (input: {
    basePayload: Record<string, unknown>
    imageModel: string | null
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
  })),
  buildImageTaskPayloadFromUserConfig: vi.fn((input: {
    basePayload: Record<string, unknown>
    imageModel: string | null
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
  })),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasCharacterAppearanceOutput: vi.fn(async () => true),
  hasGlobalCharacterAppearanceOutput: vi.fn(async () => false),
  hasGlobalCharacterOutput: vi.fn(async () => false),
  hasGlobalLocationImageOutput: vi.fn(async () => false),
  hasGlobalLocationOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
}))

type SubmitTaskCapture = {
  type?: string
  targetType?: string
  targetId?: string
  payload?: Record<string, unknown>
  dedupeKey?: string
}

const submitTaskMock = vi.hoisted(() => vi.fn<(input: SubmitTaskCapture) => Promise<{
  success: boolean
  async: boolean
  taskId: string
  status: string
  deduped: boolean
}>>(async () => ({
  success: true,
  async: true,
  taskId: 'task-1',
  status: 'queued',
  deduped: false,
})))

type SubmitImageBatchCapture = {
  type?: string
  targetType?: string
  targetId?: string
  payload?: Record<string, unknown>
  count?: number
  regenerationToken?: string | null
}

const submitImageBatchTasksMock = vi.hoisted(() => vi.fn<(input: SubmitImageBatchCapture) => Promise<{
  success: boolean
  async: boolean
  taskId: string
  taskIds: string[]
  batchId: string
  status: string
}>>(async () => ({
  success: true,
  async: true,
  taskId: 'task-0',
  taskIds: ['task-0', 'task-1', 'task-2'],
  batchId: 'batch-1',
  status: 'queued',
})))

vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/image-generation/batch-task-submitter', () => ({
  submitImageBatchTasks: submitImageBatchTasksMock,
}))
vi.mock('@/lib/image-generation/location-slots', () => ({
  ensureGlobalLocationImageSlots: vi.fn(async () => undefined),
  ensureProjectLocationImageSlots: vi.fn(async () => undefined),
}))

import { submitAssetGenerateTask } from '@/lib/assets/services/asset-actions'

describe('asset generate regeneration task payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasOutputMock.hasCharacterAppearanceOutput.mockResolvedValue(true)
  })

  it('adds a regeneration token to project character tasks that already have output', async () => {
    const request = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        count: 3,
        locale: 'zh',
      },
    })

    await submitAssetGenerateTask({
      request,
      kind: 'character',
      assetId: 'character-1',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        count: 3,
        locale: 'zh',
      },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })

    const submitArgs = submitImageBatchTasksMock.mock.calls[0]?.[0]
    if (!submitArgs?.payload) throw new Error('expected submitImageBatchTasks to be called with payload')
    expect(submitArgs).toEqual(expect.objectContaining({
      type: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      count: 3,
    }))

    const payload = submitArgs.payload
    expect(payload.regenerationToken).toEqual(expect.stringMatching(/^regen-[a-z0-9-]+$/))
    expect(submitArgs.regenerationToken).toBe(payload.regenerationToken)
    expect(submitTaskMock).not.toHaveBeenCalled()

    expect(configServiceMock.buildImageTaskPayload).toHaveBeenCalledWith(expect.objectContaining({
      basePayload: expect.objectContaining({
        id: 'character-1',
        type: 'character',
        appearanceId: 'appearance-1',
        count: 3,
        regenerationToken: payload.regenerationToken,
      }),
    }))
  })

  it('passes Codex Image into project character generation task payloads', async () => {
    configServiceMock.getProjectModelConfig.mockResolvedValueOnce({
      characterModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      editModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      videoModel: null,
      audioModel: null,
      analysisModel: null,
      videoRatio: '16:9',
      artStyle: 'realistic',
      capabilityDefaults: {},
      capabilityOverrides: {},
    })

    const request = buildMockRequest({
      path: '/api/assets/character-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        count: 1,
        locale: 'zh',
      },
    })

    await submitAssetGenerateTask({
      request,
      kind: 'character',
      assetId: 'character-1',
      body: {
        scope: 'project',
        kind: 'character',
        projectId: 'project-1',
        appearanceId: 'appearance-1',
        count: 1,
        locale: 'zh',
      },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })

    expect(configServiceMock.buildImageTaskPayload).toHaveBeenCalledWith(expect.objectContaining({
      imageModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    }))
    expect(submitTaskMock.mock.calls[0]?.[0].payload).toEqual(expect.objectContaining({
      imageModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    }))
  })

  it('passes Codex Image into project location single-image regeneration payloads', async () => {
    configServiceMock.getProjectModelConfig.mockResolvedValueOnce({
      characterModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      editModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
      videoModel: null,
      audioModel: null,
      analysisModel: null,
      videoRatio: '16:9',
      artStyle: 'realistic',
      capabilityDefaults: {},
      capabilityOverrides: {},
    })

    const request = buildMockRequest({
      path: '/api/assets/location-1/generate',
      method: 'POST',
      body: {
        scope: 'project',
        kind: 'location',
        projectId: 'project-1',
        imageIndex: 0,
        count: 1,
        locale: 'zh',
      },
    })

    await submitAssetGenerateTask({
      request,
      kind: 'location',
      assetId: 'location-1',
      body: {
        scope: 'project',
        kind: 'location',
        projectId: 'project-1',
        imageIndex: 0,
        count: 1,
        locale: 'zh',
      },
      access: {
        scope: 'project',
        userId: 'user-1',
        projectId: 'project-1',
      },
    })

    expect(configServiceMock.buildImageTaskPayload).toHaveBeenCalledWith(expect.objectContaining({
      imageModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    }))
    expect(submitTaskMock.mock.calls[0]?.[0].payload).toEqual(expect.objectContaining({
      imageModel: CODEX_DEFAULT_IMAGE_MODEL_KEY,
    }))
  })
})
