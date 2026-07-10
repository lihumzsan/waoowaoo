import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../integration/api/helpers/call-route'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../helpers/auth'
import { resetSystemState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'
import { seedMinimalDomainState } from './helpers/seed'
import { expectLifecycleEvents, listTaskEventTypes, waitForTaskTerminalState } from './helpers/tasks'
import { startSystemWorkers, stopSystemWorkers, type SystemWorkers } from './helpers/workers'
import { expectCompletedCanvasHandoff } from './helpers/canvas-terminal-handoff'

type PollState = {
  status: 'processing' | 'completed'
  resultUrl?: string
}

const videoState = vi.hoisted(() => ({
  pollResponses: new Map<string, PollState[]>(),
  uploadedCosKey: 'video/system-video.mp4',
}))

vi.mock('@/lib/ai-exec/engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-exec/engine')>('@/lib/ai-exec/engine')
  return {
    ...actual,
    generateVideo: vi.fn(async () => ({
      success: true,
      async: true,
      externalId: 'video-ext-1',
    })),
  }
})

vi.mock('@/lib/ai-exec/async-poll', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-exec/async-poll')>('@/lib/ai-exec/async-poll')
  return {
    ...actual,
    pollAsyncTask: vi.fn(async (externalId: string) => {
      const queue = videoState.pollResponses.get(externalId) || []
      const next = queue.shift()
      if (!next) {
        return { status: 'completed', resultUrl: 'https://provider.example/video-final.mp4' }
      }
      videoState.pollResponses.set(externalId, queue)
      return next
    }),
  }
})

vi.mock('@/lib/media/outbound-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/media/outbound-image')>('@/lib/media/outbound-image')
  return {
    ...actual,
    normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
  }
})

vi.mock('@/lib/workers/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/utils')>('@/lib/workers/utils')
  return {
    ...actual,
    uploadVideoSourceToCos: vi.fn(async () => videoState.uploadedCosKey),
  }
})

describe('system - generate video', () => {
  let workers: SystemWorkers = {}

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    videoState.uploadedCosKey = 'video/system-video.mp4'
    videoState.pollResponses.clear()
    videoState.pollResponses.set('video-ext-1', [
      { status: 'processing' },
      { status: 'completed', resultUrl: 'https://provider.example/video-final.mp4' },
    ])
    await resetSystemState()
    installAuthMocks()
  })

  afterEach(async () => {
    await stopSystemWorkers(workers)
    workers = {}
    resetAuthMockState()
  })

  it('[P0:SYS-VIDEO-SUCCESS] [P0:SYS-CANVAS-TERMINAL-NO-GAP] queued video materializes before the Canvas terminal handoff', async () => {
    const seeded = await seedMinimalDomainState()
    await prisma.projectPanel.update({
      where: { id: seeded.panel.id },
      data: {
        duration: 5,
        videoPrompt: '单镜头视频提示词：镜头保持中景，Narrator 在办公室里轻微转身，灯光稳定。',
      },
    })
    mockAuthenticated(seeded.user.id)
    workers = await startSystemWorkers(['video'])

    const mod = await import('@/app/api/projects/[projectId]/generate-video/route')
    const response = await callRoute(
      mod.POST,
      'POST',
      {
        locale: 'zh',
        episodeId: seeded.episode.id,
        storyboardId: seeded.storyboard.id,
        panelIndex: 0,
        confirmed: true,
        generationOptions: {
          resolution: '720p',
          generateAudio: false,
        },
      },
      { params: { projectId: seeded.project.id } },
    )

    expect(response.status).toBe(200)
    const json = await response.json() as { async: boolean; taskId: string }
    const task = await waitForTaskTerminalState(json.taskId)

    expect(task.status).toBe('completed')
    expect(task.type).toBe('video_panel')
    expect(task.externalId).toBe('video-ext-1')

    const panel = await prisma.projectPanel.findUnique({
      where: { id: seeded.panel.id },
      select: { videoUrl: true, lastVideoGenerationOptions: true },
    })
    expect(panel?.videoUrl).toBe(videoState.uploadedCosKey)
    expect(panel?.lastVideoGenerationOptions).toEqual({
      resolution: '720p',
      generateAudio: false,
    })

    const eventTypes = await listTaskEventTypes(json.taskId)
    expectLifecycleEvents(eventTypes, 'completed')
    await expectCompletedCanvasHandoff({
      projectId: seeded.project.id,
      episodeId: seeded.episode.id,
      taskId: json.taskId,
      taskType: 'video_panel',
      targetType: 'ProjectPanel',
      targetId: seeded.panel.id,
      persistedOutput: videoState.uploadedCosKey,
    })
  })
})
