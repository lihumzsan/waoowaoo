import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../integration/api/helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../helpers/auth'
import { resetSystemState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import { seedMinimalDomainState } from './helpers/seed'
import { expectLifecycleEvents, listTaskEventTypes, waitForTaskTerminalState } from './helpers/tasks'
import { startSystemWorkers, stopSystemWorkers, type SystemWorkers } from './helpers/workers'
import {
  bindAssistantWaitToSystemTask,
  expectTerminalFailureConsistency,
} from './helpers/terminal-failure-consistency'

const imageState = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'fatal' | 'transient-once',
  cosKey: 'cos/system-image-generated.png',
  errorMessage: 'IMAGE_GENERATION_FATAL',
  calls: 0,
  appearanceId: null as string | null,
  observedBeforeRetry: null as null | {
    imageUrl: string | null
    taskStatus: string
    taskAttempt: number
  },
}))

vi.mock('@/lib/task/retry-policy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task/retry-policy')>('@/lib/task/retry-policy')
  return {
    ...actual,
    TASK_RETRY_BACKOFF_BASE_MS: 25,
  }
})

vi.mock('@/lib/project-agent/server-follow-up', () => ({
  scheduleResolvedProjectAgentWaitFollowUpsForTaskEvent: vi.fn(),
}))

vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateCleanImageToStorage: vi.fn(async () => {
      imageState.calls += 1
      if (imageState.mode === 'fatal') {
        throw new Error(imageState.errorMessage)
      }
      if (imageState.mode === 'transient-once' && imageState.calls === 1) {
        throw Object.assign(new Error('upstream service unavailable 503'), { code: 'EXTERNAL_ERROR' })
      }
      if (imageState.mode === 'transient-once' && imageState.appearanceId) {
        const { prisma: runtimePrisma } = await import('@/lib/prisma')
        const [appearance, task] = await Promise.all([
          runtimePrisma.characterAppearance.findUnique({
            where: { id: imageState.appearanceId },
            select: { imageUrl: true },
          }),
          runtimePrisma.task.findFirst({
            where: { targetType: 'CharacterAppearance', targetId: imageState.appearanceId },
            orderBy: { createdAt: 'desc' },
            select: { status: true, attempt: true },
          }),
        ])
        if (!task) throw new Error('SYSTEM_RETRY_TASK_NOT_FOUND')
        imageState.observedBeforeRetry = {
          imageUrl: appearance?.imageUrl ?? null,
          taskStatus: task.status,
          taskAttempt: task.attempt,
        }
      }
      return imageState.cosKey
    }),
  }
})

vi.mock('@/lib/media/outbound-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/media/outbound-image')>('@/lib/media/outbound-image')
  return {
    ...actual,
    normalizeReferenceImagesForGeneration: vi.fn(async (refs: string[]) => refs.map((item) => `normalized:${item}`)),
  }
})

vi.mock('@/lib/ai-exec/engine', () => ({
  executeAiTextStep: vi.fn(async () => ({
    text: JSON.stringify({
      prompts: [
        'identity-focused character asset prompt',
        'wardrobe-focused character asset prompt',
        'storyboard-energy character asset prompt',
      ],
    }),
    reasoning: '',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    completion: { id: 'completion-1' },
  })),
}))

describe('system - generate image', () => {
  let workers: SystemWorkers = {}

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    imageState.mode = 'success'
    imageState.cosKey = 'cos/system-image-generated.png'
    imageState.errorMessage = 'IMAGE_GENERATION_FATAL'
    imageState.calls = 0
    imageState.appearanceId = null
    imageState.observedBeforeRetry = null
    await resetSystemState()
    installAuthMocks()
  })

  afterEach(async () => {
    await stopSystemWorkers(workers)
    workers = {}
    resetAuthMockState()
  })

  it('[P0:SYS-IMAGE-SUCCESS] route -> queue -> worker -> db writes imageUrl and lifecycle events', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)
    workers = await startSystemWorkers(['image'])

    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        scope: 'project',
        kind: 'character',
        projectId: seeded.project.id,
        locale: 'zh',
        appearanceId: seeded.appearance.id,
        count: 1,
        confirmed: true,
      },
      { params: { assetId: seeded.character.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { async: boolean; taskId: string }
    expect(json.async).toBe(true)
    expect(typeof json.taskId).toBe('string')

    const task = await waitForTaskTerminalState(json.taskId)
    expect(task.status).toBe('completed')
    expect(task.type).toBe('image_character')
    expect(task.targetId).toBe(seeded.appearance.id)

    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: seeded.appearance.id },
      select: { descriptions: true, imageUrl: true, imageUrls: true, selectedIndex: true },
    })
    expect(appearance).toEqual({
      descriptions: null,
      imageUrl: imageState.cosKey,
      imageUrls: JSON.stringify([imageState.cosKey]),
      selectedIndex: 0,
    })

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'completed')
  })

  it('[P0:SYS-PROVIDER-FAILURE-NO-FALLBACK] [P0:SYS-TERMINAL-FAILURE-CONSISTENCY] fatal provider failure stays consistent across Task, Agent, Canvas, and billing', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)
    imageState.mode = 'fatal'
    imageState.errorMessage = 'IMAGE_GENERATION_FATAL'

    const originalAppearance = await prisma.characterAppearance.findUnique({
      where: { id: seeded.appearance.id },
      select: { imageUrl: true, imageUrls: true, selectedIndex: true },
    })

    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        scope: 'project',
        kind: 'character',
        projectId: seeded.project.id,
        locale: 'zh',
        appearanceId: seeded.appearance.id,
        count: 1,
        confirmed: true,
      },
      { params: { assetId: seeded.character.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { taskId: string }
    await bindAssistantWaitToSystemTask({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      taskId: json.taskId,
      targetType: 'CharacterAppearance',
      targetId: seeded.appearance.id,
    })
    workers = await startSystemWorkers(['image'])
    const task = await waitForTaskTerminalState(json.taskId)
    expect(task.status).toBe('failed')
    expect(task.errorMessage).toContain('IMAGE_GENERATION_FATAL')
    expect(task.billingInfo).toMatchObject({
      billable: true,
      modeSnapshot: 'OFF',
      status: 'skipped',
    })

    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: seeded.appearance.id },
      select: { imageUrl: true, imageUrls: true, selectedIndex: true },
    })
    expect(appearance).toEqual(originalAppearance)

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'failed')
    await expectTerminalFailureConsistency({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      taskId: json.taskId,
      targetType: 'CharacterAppearance',
      targetId: seeded.appearance.id,
      expectedError: imageState.errorMessage,
    })
  })

  it('[P0:SYS-TASK-RETRY-SUCCESS] transient attempt failure retries without exposing a premature target failure', async () => {
    const seeded = await seedMinimalDomainState()
    mockAuthenticated(seeded.user.id)
    imageState.mode = 'transient-once'
    imageState.appearanceId = seeded.appearance.id
    workers = await startSystemWorkers(['image'])

    const mod = await import('@/app/api/assets/[assetId]/generate/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        scope: 'project',
        kind: 'character',
        projectId: seeded.project.id,
        locale: 'zh',
        appearanceId: seeded.appearance.id,
        count: 1,
        confirmed: true,
      },
      { params: { assetId: seeded.character.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { taskId: string }
    const task = await waitForTaskTerminalState(json.taskId)
    expect(task).toMatchObject({
      status: 'completed',
      attempt: 2,
      errorCode: null,
      errorMessage: null,
    })
    expect(imageState.calls).toBe(2)
    expect(imageState.observedBeforeRetry).toEqual({
      imageUrl: 'images/character-seed.jpg',
      taskStatus: 'processing',
      taskAttempt: 2,
    })

    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: seeded.appearance.id },
      select: { imageUrl: true, imageUrls: true, selectedIndex: true },
    })
    expect(appearance).toEqual({
      imageUrl: imageState.cosKey,
      imageUrls: JSON.stringify([imageState.cosKey]),
      selectedIndex: 0,
    })

    const eventTypes = await listTaskEventTypes(json.taskId)
    expect(eventTypes.filter((type) => type === TASK_EVENT_TYPE.PROCESSING)).toHaveLength(2)
    expect(eventTypes).not.toContain(TASK_EVENT_TYPE.FAILED)
    expectLifecycleEvents(eventTypes, 'completed')
  }, 30_000)
})
