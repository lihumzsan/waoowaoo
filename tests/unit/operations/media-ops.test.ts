import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import type { Prisma } from '@prisma/client'

const submitTaskMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    taskId: 'task-1',
    async: true,
    status: 'queued',
    runId: null,
    deduped: false,
  })),
)
const submitApprovedPlanMock = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Map([
        [
          'regenerate-group:CharacterAppearance:appearance-1',
          {
            success: true,
            taskId: 'task-1',
            async: true,
            status: 'queued',
            runId: null,
            deduped: false,
          },
        ],
        [
          'regenerate-single:image_character:appearance-1:0',
          {
            success: true,
            taskId: 'task-1',
            async: true,
            status: 'queued',
            runId: null,
            deduped: false,
          },
        ],
      ]),
  ),
)
vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))
vi.mock('@/lib/task/approved-plan-submitter', () => ({
  submitApprovedOperationPlanTasks: submitApprovedPlanMock,
}))

vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))

vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn((taskType: string) => ({
    billable: true,
    source: 'task',
    taskType,
    apiType: 'image',
    model: 'img::character',
    quantity: 1,
    unit: 'image',
    maxFrozenCost: 1,
    action: taskType,
    status: 'quoted',
  })),
}))

const configMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    characterModel: 'img::character',
    locationModel: 'img::location',
    editModel: 'img::edit',
    analysisModel: 'llm::analysis',
  })),
  buildImageBillingPayload: vi.fn(async (input: { basePayload: Record<string, unknown> }) => input.basePayload),
}))
vi.mock('@/lib/config-service', () => configMock)

const hasOutputMock = vi.hoisted(() => ({
  hasCharacterAppearanceOutput: vi.fn(async () => false),
  hasLocationImageOutput: vi.fn(async () => false),
  hasPanelImageOutput: vi.fn(async () => false),
}))
vi.mock('@/lib/task/has-output', () => hasOutputMock)

const locationSlotsMock = vi.hoisted(() => ({
  ensureProjectLocationImageSlots: vi.fn(async () => undefined),
}))
vi.mock('@/lib/image-generation/location-slots', () => locationSlotsMock)

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(async () => ({
      visualStylePresetSource: 'system',
      visualStylePresetId: 'realistic',
      artStyle: 'realistic',
    })),
  },
  projectLocation: {
    findUnique: vi.fn(async () => ({ name: 'loc', summary: 'sum' })),
  },
  projectPanel: {
    findFirst: vi.fn(async () => ({ id: 'panel-1' })),
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/media/outbound-image', () => ({
  sanitizeImageInputsForTaskPayload: vi.fn((inputs: unknown[]) => ({
    normalized: inputs.filter((x): x is string => typeof x === 'string'),
    issues: [],
  })),
}))

import { createMediaOperations } from '@/lib/operations/domains/media/media-ops'

function buildCtx() {
  return {
    request: new Request('http://localhost') as unknown as import('next/server').NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: {},
    source: 'assistant-panel',
    writer: null,
    executionAuthorization: {
      approvalGrantId: 'approval-grant-1',
      operationExecutionId: 'operation-execution-1',
      transaction: prismaMock as unknown as Prisma.TransactionClient,
    },
  }
}

describe('media operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('regenerate_group -> submits REGENERATE_GROUP task', async () => {
    const ops = createMediaOperations()
    const ctx = buildCtx()
    const plan = await ops.regenerate_group.plan?.(ctx as never, {
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
      count: 2,
    })
    if (!plan || !ops.regenerate_group.commit) throw new Error('EXPECTED_REGENERATE_GROUP_PLAN_COMMIT')
    await ops.regenerate_group.commit(
      ctx as never,
      {
        type: 'character',
        id: 'character-1',
        appearanceId: 'appearance-1',
        count: 2,
      },
      plan,
    )
    expect(plan?.tasks[0]).toEqual(expect.objectContaining({ taskType: TASK_TYPE.REGENERATE_GROUP }))
  })

  it('regenerate_single_image -> submits IMAGE_CHARACTER task', async () => {
    const ops = createMediaOperations()
    const ctx = buildCtx()
    const plan = await ops.regenerate_single_image.plan?.(ctx as never, {
      type: 'character',
      id: 'character-1',
      appearanceId: 'appearance-1',
      imageIndex: 0,
    })
    if (!plan || !ops.regenerate_single_image.commit) throw new Error('EXPECTED_REGENERATE_SINGLE_PLAN_COMMIT')
    await ops.regenerate_single_image.commit(
      ctx as never,
      {
        type: 'character',
        id: 'character-1',
        appearanceId: 'appearance-1',
        imageIndex: 0,
      },
      plan,
    )
    expect(plan?.tasks[0]).toEqual(
      expect.objectContaining({
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        target: { targetType: 'CharacterAppearance', targetId: 'appearance-1' },
      }),
    )
  })
})
