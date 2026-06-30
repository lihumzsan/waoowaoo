import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlanRun } from '@/lib/plan-run-runtime/service'

const prismaState = vi.hoisted(() => {
  const tx = {
    planRun: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    planStepRun: {
      createMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    planRunEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    planArtifact: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  }

  return {
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async <T>(fn: (txArg: typeof tx) => Promise<T>): Promise<T> => fn(tx)),
    },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: prismaState.prisma,
}))

function buildPlanRunRow() {
  const now = new Date('2026-05-05T00:00:00.000Z')
  return {
    id: 'plan-run-1',
    userId: 'user-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    goal: 'write scene',
    status: 'queued',
    currentStepKey: null,
    errorCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    lastSeq: 0,
    createdAt: now,
    updatedAt: now,
  }
}

describe('plan run runtime service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.tx.planRun.create.mockResolvedValue(buildPlanRunRow())
    prismaState.tx.planStepRun.createMany.mockResolvedValue({ count: 0 })
  })

  it('creates a PlanRun record', async () => {
    const planRun = await createPlanRun({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      goal: 'write scene',
    })

    expect(planRun.goal).toBe('write scene')
    expect(prismaState.tx.planRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        goal: 'write scene',
      }),
    }))
  })

  it('creates PlanRun steps with operation ids only', async () => {
    await createPlanRun({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      goal: 'write scene',
      steps: [
        {
          stepKey: 'context',
          operationId: 'get_project_context',
          stepIndex: 1,
          stepTotal: 1,
        },
      ],
    })

    expect(prismaState.tx.planStepRun.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          planRunId: 'plan-run-1',
          stepKey: 'context',
          operationId: 'get_project_context',
        }),
      ],
    })
    expect(prismaState.tx.planStepRun.createMany).not.toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          skillId: expect.anything(),
        }),
      ],
    })
  })
})
