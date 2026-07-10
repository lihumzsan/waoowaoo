import type { Job } from 'bullmq'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHARACTER_ASSET_IMAGE_RATIO, LOCATION_IMAGE_RATIO, PROP_IMAGE_RATIO } from '@/lib/constants'

import { TASK_TYPE, type TaskJobData, type TaskType } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
  getProjectModels: vi.fn(async () => ({ editModel: 'edit-model', analysisModel: 'analysis-model' })),
  getUserModels: vi.fn(async () => ({ editModel: 'edit-model', analysisModel: 'analysis-model' })),
  resolveImageSourceFromGeneration: vi.fn(async () => 'generated-image-source'),
  toSignedUrlIfCos: vi.fn(() => 'https://signed/current-image.png'),
  uploadImageSourceToCos: vi.fn(async () => 'cos/new-image.png'),
}))

const outboundImageMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async (input?: string[]) => input?.map((item) => item.trim()) || []),
  normalizeOptionalReferenceImagesForGeneration: vi.fn(async (input?: string[]) => input?.map((item) => item.trim()) || []),
  normalizeToBase64ForGeneration: vi.fn(async () => 'base64-reference'),
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '{"prompt":"TEXT_UPDATED_DESCRIPTION"}' })),
  executeAiVisionStep: vi.fn(async () => ({ text: '{"prompt":"VISION_UPDATED_DESCRIPTION"}' })),
}))

const promptMock = vi.hoisted(() => ({
  AI_PROMPT_IDS: {
    CHARACTER_UPDATE_DESCRIPTION: 'character-update-description',
    LOCATION_UPDATE_DESCRIPTION: 'location-update-description',
    PROP_UPDATE_DESCRIPTION: 'prop-update-description',
  },
  buildAiPrompt: vi.fn(({ promptId }: { promptId: string }) => `${promptId}-prompt`),
}))

const loggerWarnMock = vi.hoisted(() => vi.fn())

const loggingMock = vi.hoisted(() => ({
  createScopedLogger: vi.fn(() => ({
    warn: loggerWarnMock,
  })),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  locationImage: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  globalCharacter: {
    findFirst: vi.fn(),
  },
  globalCharacterAppearance: {
    update: vi.fn(async () => ({})),
  },
  globalLocation: {
    findFirst: vi.fn(),
  },
  globalLocationImage: {
    update: vi.fn(async () => ({})),
  },
}))

vi.mock('@/lib/workers/utils', () => utilsMock)

vi.mock('@/lib/media/outbound-image', () => outboundImageMock)

vi.mock('@/lib/ai-exec/engine', () => aiRuntimeMock)

vi.mock('@/lib/ai-prompts', () => promptMock)

vi.mock('@/lib/logging/core', () => loggingMock)

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/location-spatial-profile/service', () => ({
  analyzeAndPersistProjectLocationImageSpatialProfile: vi.fn(async () => ({
    schemaVersion: 1,
    sceneSummary: 'updated project location',
    anchors: [{
      id: 'anchor-1',
      label: 'project anchor',
      screenArea: 'center',
      depthLayer: 'midground',
      spatialRelations: ['near the entrance'],
    }],
    depthLayout: {
      foreground: 'foreground',
      midground: 'midground',
      background: 'background',
    },
    lightingDirection: 'from the left',
  })),
  analyzeAndPersistGlobalLocationImageSpatialProfile: vi.fn(async () => ({
    schemaVersion: 1,
    sceneSummary: 'updated global location',
    anchors: [{
      id: 'anchor-1',
      label: 'global anchor',
      screenArea: 'center',
      depthLayer: 'midground',
      spatialRelations: ['near the entrance'],
    }],
    depthLayout: {
      foreground: 'foreground',
      midground: 'midground',
      background: 'background',
    },
    lightingDirection: 'from the left',
  })),
}))

import { handleModifyAssetImageTask } from '@/lib/workers/handlers/image-task-handlers-core'

import { handleAssetHubModifyTask } from '@/lib/workers/handlers/asset-hub-modify-task-handler'

function buildJob(type: TaskType, payload: Record<string, unknown>): Job<TaskJobData> {
  const assetType = typeof payload.type === 'string' ? payload.type : 'prop'
  const aspectRatio = assetType === 'character'
    ? CHARACTER_ASSET_IMAGE_RATIO
    : assetType === 'location'
      ? LOCATION_IMAGE_RATIO
      : PROP_IMAGE_RATIO
  const generationOptions = payload.generationOptions && typeof payload.generationOptions === 'object'
    ? payload.generationOptions
    : { aspectRatio }
  return {
    data: {
      taskId: 'task-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'GlobalCharacter',
      targetId: 'target-1',
      payload: {
        generationOptions,
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function getUpdateData(callArg: unknown): Record<string, unknown> {
  if (!callArg || typeof callArg !== 'object') return {}
  const maybeData = (callArg as { data?: unknown }).data
  if (!maybeData || typeof maybeData !== 'object') return {}
  return maybeData as Record<string, unknown>
}

export type { Job } from 'bullmq'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export { CHARACTER_ASSET_IMAGE_RATIO, LOCATION_IMAGE_RATIO, PROP_IMAGE_RATIO } from '@/lib/constants'
export { TASK_TYPE } from '@/lib/task/types'
export type { TaskJobData, TaskType } from '@/lib/task/types'
export { handleModifyAssetImageTask } from '@/lib/workers/handlers/image-task-handlers-core'
export { handleAssetHubModifyTask } from '@/lib/workers/handlers/asset-hub-modify-task-handler'
export { aiRuntimeMock, buildJob, getUpdateData, loggerWarnMock, loggingMock, outboundImageMock, prismaMock, promptMock, utilsMock }
