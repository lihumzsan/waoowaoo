import type { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { vi } from 'vitest'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

export { beforeEach, describe, expect, it } from 'vitest'
export { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditScript: { findMany: vi.fn(), findFirst: vi.fn() },
  projectEditAssetRequirement: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  projectCharacter: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  projectLocation: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}))

const readEpisodeEditBibleMock = vi.hoisted(() => vi.fn())
const readEpisodeEditChaptersMock = vi.hoisted(() => vi.fn())
const readProjectEditScriptsMock = vi.hoisted(() => vi.fn())
const planAssetGenerateTaskMock = vi.hoisted(() => vi.fn())
const submitPlannedOperationTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/edit-bible', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edit-bible')>()),
  readEpisodeEditBible: readEpisodeEditBibleMock,
  readEpisodeEditChapters: readEpisodeEditChaptersMock,
}))
vi.mock('@/lib/edit-script/service', () => ({ readProjectEditScripts: readProjectEditScriptsMock }))
vi.mock('@/lib/assets/services/asset-actions', () => ({ planAssetGenerateTask: planAssetGenerateTaskMock }))
vi.mock('@/lib/operations/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/operations/planning')>()),
  submitPlannedOperationTask: submitPlannedOperationTaskMock,
}))

export {
  commitProjectEditScriptAssetsOperation,
  planProjectEditScriptAssetsOperation,
} from '@/lib/edit-script/asset-generation-operation-plan'

export const billingInfo: TaskBillingInfo = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.IMAGE_CHARACTER,
  apiType: 'image',
  model: 'image-model',
  quantity: 1,
  unit: 'image',
  maxFrozenCost: 1,
  action: TASK_TYPE.IMAGE_CHARACTER,
  status: 'quoted',
}

function request(): NextRequest {
  return new Request('http://localhost', {
    headers: { 'accept-language': 'zh' },
  }) as unknown as NextRequest
}

export function operationContext() {
  return {
    request: request(),
    userId: 'user-1',
    projectId: 'project-1',
    context: { locale: 'zh', episodeId: 'episode-1' },
    source: 'project-ui',
    writer: null,
    toolCallId: null,
  }
}

export function authorizedOperationContext() {
  return {
    ...operationContext(),
    executionAuthorization: {
      approvalGrantId: 'approval-grant-1',
      operationExecutionId: 'operation-execution-1',
      transaction: prismaMock as unknown as Prisma.TransactionClient,
    },
  }
}

export function requirement(id: string, name: string) {
  return {
    id,
    kind: 'character' as const,
    name,
    description: `${name} design`,
    shotIds: ['shot-1'],
    status: 'pending' as const,
    targetId: null,
    errorMessage: null,
  }
}

export function script(id: string, chapterId: string, requirements: readonly ReturnType<typeof requirement>[]) {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    durationSec: 3,
    shotCount: 1,
    assetReviewStatus: 'pending' as const,
    styleBible: null,
    shots: [],
    generationSegments: [],
    requirements,
  }
}

export function setupAssetGenerationScopeMocks(): void {
  vi.clearAllMocks()
  readEpisodeEditBibleMock.mockResolvedValue({
    stylePreviews: [{ status: 'confirmed', imageUrl: 'https://cdn.example/style.png' }],
  })
  readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }])
  prismaMock.projectEditScript.findMany.mockResolvedValue([
    { chapterId: 'chapter-1', status: 'ready' },
    { chapterId: 'chapter-2', status: 'ready' },
  ])
  prismaMock.projectEditScript.findFirst.mockResolvedValue({
    id: 'script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    corePlanJson: {
      shots: [{
        shotId: 'shot-1', shotNumber: 1, shotPurpose: 'action', durationSec: 3,
        scene: { locationId: 'location-1', name: 'Location', subScene: 'Room' },
        action: 'Action', characters: [], keyObjects: [], dialogue: [], sound: 'room tone',
      }],
      generationSegments: [{ shotIds: ['shot-1'], continuity: 'single shot' }],
    },
    durationSec: 3,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    requirements: [],
  })
  prismaMock.projectCharacter.findMany.mockResolvedValue([])
  prismaMock.projectLocation.findMany.mockResolvedValue([])
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof prismaMock) => Promise<unknown>) => await callback(prismaMock),
  )
  planAssetGenerateTaskMock.mockImplementation(
    async (input: { assetId: string; body: { appearanceId?: string } }) => ({
      userId: 'user-1',
      projectId: 'project-1',
      task: {
        id: `planned:${input.assetId}`,
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        target: { targetType: 'CharacterAppearance', targetId: input.body.appearanceId! },
        payload: { id: input.assetId, appearanceId: input.body.appearanceId },
        billingInfo,
        locale: 'zh',
        episodeId: 'episode-1',
      },
    }),
  )
}

export {
  planAssetGenerateTaskMock,
  prismaMock,
  readEpisodeEditBibleMock,
  readEpisodeEditChaptersMock,
  readProjectEditScriptsMock,
  submitPlannedOperationTaskMock,
}
