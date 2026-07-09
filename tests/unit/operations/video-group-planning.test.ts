import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot, EditShotExecution } from '@/lib/edit-script/types'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { TASK_TYPE } from '@/lib/task/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

const CONTINUOUS_PROMPT = 'ShotExecutionPlan continuous segment prompt. 16:9, same room and same screen direction. [00:00-00:02] Shot 1: Hero remains screen left of Chair and says "Hold the line." <room tone continues> [00:02-00:05] Shot 2: Hero moves closer while Chair stays screen center. <floor creak continues>'

const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(),
  },
  projectEditChapter: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectPanel: {
    findMany: vi.fn(),
  },
  projectVideoGroup: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const storyboardSourceMock = vi.hoisted(() => ({
  buildStoryboardConsistencySource: vi.fn(),
}))

const resolveSystemModelKeyMock = vi.hoisted(() => vi.fn(async () => 'google::veo-test'))
const submitOperationTaskMock = vi.hoisted(() => vi.fn(async () => ({
  taskId: 'task-video-group-1',
  status: 'queued',
  runId: null,
  deduped: false,
  billingReceiptView: null,
})))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/edit-script/storyboard-consistency/source-snapshot', () => ({
  buildStoryboardConsistencySource: storyboardSourceMock.buildStoryboardConsistencySource,
}))
vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: resolveSystemModelKeyMock,
}))
vi.mock('@/lib/operations/submit-operation-task', () => ({
  submitOperationTask: submitOperationTaskMock,
}))
vi.mock('@/lib/deployment/config', () => ({
  getDeploymentConfig: vi.fn(() => ({ edition: 'self-hosted' })),
  isCloudDeployment: vi.fn(() => false),
}))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/ai-registry/selection', () => ({
  parseModelKeyStrict: vi.fn((modelKey: string) => {
    const separatorIndex = modelKey.indexOf('::')
    if (separatorIndex <= 0 || separatorIndex >= modelKey.length - 2) return null
    return {
      provider: modelKey.slice(0, separatorIndex),
      modelId: modelKey.slice(separatorIndex + 2),
    }
  }),
}))
vi.mock('@/lib/ai-registry/capabilities-catalog', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => null),
  registerBuiltinCapabilityCatalogEntries: vi.fn(),
}))
vi.mock('@/lib/config-service', () => ({
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})),
}))
vi.mock('@/lib/ai-registry/pricing-resolution', () => ({
  resolveBuiltinPricing: vi.fn(() => ({ status: 'ok' })),
  registerBuiltinPricingCatalogEntries: vi.fn(),
}))
vi.mock('@/lib/ai-exec/video-token-pricing', () => ({
  resolveAiVideoTokenPricingContract: vi.fn(() => null),
}))
vi.mock('@/lib/billing', () => ({
  getBillingMode: vi.fn(async () => 'OFF'),
  buildDefaultTaskBillingInfo: vi.fn((taskType: string, payload: Record<string, unknown>) => ({
    billable: true,
    source: 'task',
    taskType,
    apiType: 'video',
    model: typeof payload.videoModel === 'string' ? payload.videoModel : 'unknown',
    quantity: 1,
    unit: 'second',
    maxFrozenCost: 1,
    action: taskType,
    status: 'quoted',
  })),
}))

import { createVideoGenerationOperations } from '@/lib/operations/domains/storyboard/generation/video'
import { planVideoGroupTask } from '@/lib/operations/domains/storyboard/generation/video/video-group-planning'

function buildContext(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost/api/projects/project-1/assistant') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: { episodeId: 'episode-1', locale: 'zh' },
    source: 'test',
    writer: null,
    toolCallId: null,
  }
}

function buildShots(): readonly EditScriptShot[] {
  return [
    {
      shotId: 'shot-1',
      shotNumber: 1,
      shotPurpose: 'action',
      durationSec: 2,
      scene: { locationId: 'location-1', name: 'Test Room', subScene: 'Test Room' },
      action: 'Hero stands beside the chair.',
      characters: [
        {
          characterId: 'character-1',
          name: 'Hero',
          visibility: 'visible',
          role: 'focus',
          performance: 'holds still beside the chair',
        },
      ],
      keyObjects: [
        { name: 'Chair', role: 'blocking_anchor' },
      ],
      dialogue: [
        { characterId: 'character-1', line: 'Hold the line.' },
      ],
      sound: 'room tone',
    },
    {
      shotId: 'shot-2',
      shotNumber: 2,
      shotPurpose: 'action',
      durationSec: 3,
      scene: { locationId: 'location-1', name: 'Test Room', subScene: 'Test Room' },
      action: 'Hero steps closer to the chair.',
      characters: [
        {
          characterId: 'character-1',
          name: 'Hero',
          visibility: 'visible',
          role: 'focus',
          performance: 'moves closer without reversing screen direction',
        },
      ],
      keyObjects: [
        { name: 'Chair', role: 'blocking_anchor' },
      ],
      dialogue: [],
      sound: 'floor creak',
    },
  ]
}

function buildExecutionShot(shot: EditScriptShot): EditShotExecution {
  const dialogueText = shot.dialogue.map((line) => line.line).join(' ')
  return {
    shotId: shot.shotId,
    shotNumber: shot.shotNumber,
    camera: {
      shotScale: 'medium',
      lens: '35mm',
      focus: 'Hero and Chair remain clear',
      height: 'eye level',
      angle: 'straight-on',
      movement: shot.shotNumber === 1 ? 'locked off' : 'slow push',
      composition: 'Hero remains screen left and Chair remains screen center',
      lighting: 'soft side light keeps spatial continuity',
    },
    blocking: {
      axis: {
        type: 'subject_line',
        subjects: ['Hero', 'Chair'],
        screenDirection: 'Hero remains screen left of Chair',
      },
      characters: [
        {
          name: 'Hero',
          visibility: 'visible',
          position: 'beside the chair',
          screenPosition: 'screen left',
          facing: 'toward the chair',
          eyeline: 'chair',
        },
      ],
      objects: [
        {
          name: 'Chair',
          position: 'center of the room',
          screenPosition: 'screen center',
        },
      ],
      spatialNote: 'Hero and Chair preserve the same axis.',
    },
    videoPrompt: `Single-shot video prompt for shot ${shot.shotNumber}: Hero stays screen left of Chair and preserves the same room axis.${dialogueText ? ` Hero says "${dialogueText}".` : ''}`,
  }
}

function buildSegmentExecution(segment: EditGenerationSegment): EditGenerationSegmentExecution {
  return {
    shotIds: segment.shotIds,
    continuousVideoPrompt: CONTINUOUS_PROMPT,
  }
}

function buildSourceSnapshot(): StoryboardConsistencySourceSnapshot {
  const shots = buildShots()
  const segment: EditGenerationSegment = {
    shotIds: ['shot-1', 'shot-2'],
    continuity: 'Hero approaches the chair in one continuous room beat.',
  }
  return {
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    project: { videoRatio: '16:9' },
    editScript: {
      id: 'edit-script-1',
      durationSec: 5,
      shotCount: 2,
      sourceText: 'test bible',
    },
    styleBible: buildZenStyleBibleFixture(),
    shots,
    shotExecutionPlan: {
      shots: shots.map((shot) => buildExecutionShot(shot)),
      generationSegmentExecutions: [buildSegmentExecution(segment)],
    },
    generationSegments: [
      {
        ...segment,
        segmentIndex: 0,
        sourceGenerationSegmentId: 'edit-script-1:generationSegment:1',
      },
    ],
    assets: [],
  }
}

describe('video group planning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const sourceSnapshot = buildSourceSnapshot()
    prismaMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.projectEditChapter.findFirst.mockImplementation(async (query: {
      readonly where?: {
        readonly id?: string
      }
    }) => ({ id: query.where?.id ?? 'chapter-1', chapterIndex: 0 }))
    prismaMock.projectEditChapter.findMany.mockResolvedValue([{ id: 'chapter-1', chapterIndex: 0 }])
    prismaMock.projectEditChapter.findUnique.mockResolvedValue({ id: 'chapter-1', chapterIndex: 0 })
    prismaMock.projectEditChapter.create.mockResolvedValue({ id: 'chapter-1', chapterIndex: 0 })
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      id: 'edit-script-1',
      corePlanJson: {
        shots: sourceSnapshot.shots,
        generationSegments: sourceSnapshot.generationSegments.map(({ shotIds, continuity }) => ({
          shotIds,
          continuity,
        })),
      },
    })
    prismaMock.projectPanel.findMany.mockResolvedValue([
      { id: 'panel-1', panelNumber: 1, sourceShotId: 'shot-1', imageUrl: 'images/panel-1.png', imageMediaId: null },
      { id: 'panel-2', panelNumber: 2, sourceShotId: 'shot-2', imageUrl: 'images/panel-2.png', imageMediaId: null },
    ])
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([])
    storyboardSourceMock.buildStoryboardConsistencySource.mockResolvedValue({
      sourceSnapshot,
      modelConfigSnapshot: {
        analysisModel: 'openai::gpt-4.1',
        storyboardModel: 'google::imagen',
      },
    })
  })

  it('plans video groups from ShotExecutionPlan continuous prompts', async () => {
    const planned = await planVideoGroupTask({
      ctx: buildContext(),
      input: {
        generationOptions: {
          resolution: '720p',
        },
      },
      operationId: 'generate_edit_script_storyboard_videos',
      episodeId: 'episode-1',
      gridMode: '2x2',
      shotIds: ['shot-1', 'shot-2'],
    })

    expect(planned.task.taskType).toBe(TASK_TYPE.VIDEO_GROUP)
    expect(planned.task.payload).toEqual(expect.objectContaining({
      videoModel: 'google::veo-test',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      gridMode: '2x2',
      shotIds: ['shot-1', 'shot-2'],
      durationSec: 5,
      generationOptions: expect.objectContaining({
        duration: 5,
        resolution: '720p',
      }),
    }))
    expect(planned.metadata.prompt).toBe(CONTINUOUS_PROMPT)
    expect(storyboardSourceMock.buildStoryboardConsistencySource).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      editScriptId: 'edit-script-1',
      userId: 'user-1',
    })
  })

  it('plans asset-reference video groups from ShotExecutionPlan continuous prompts without prior video group prompt', async () => {
    const operation = createVideoGenerationOperations().generate_asset_reference_video
    const plan = await operation.plan?.(buildContext(), {
      episodeId: 'episode-1',
      segmentIndex: 0,
      referenceImageUrls: ['https://example.com/hero.png'],
      prompt: 'request prompt must not be used',
    })

    expect(plan).toBeDefined()
    expect(plan?.operationId).toBe('generate_asset_reference_video')
    expect(plan?.tasks).toHaveLength(1)
    expect(plan?.tasks[0]?.taskType).toBe(TASK_TYPE.VIDEO_GROUP)
    expect(plan?.tasks[0]?.payload).toEqual(expect.objectContaining({
      videoModel: 'google::veo-test',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      gridMode: '2x2',
      shotIds: ['shot-1', 'shot-2'],
      sourceMode: 'asset_reference',
      referenceImageUrls: ['https://example.com/hero.png'],
      durationSec: 5,
      generationOptions: expect.objectContaining({
        duration: 5,
      }),
    }))
    expect(plan?.tasks[0]?.payload).not.toHaveProperty('prompt')
    expect(plan?.metadata).toEqual(expect.objectContaining({
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      sourceMode: 'asset_reference',
      segmentIndex: 0,
      videoGroups: [
        expect.objectContaining({
          sourceMode: 'asset_reference',
          segmentIndex: 0,
          shotIds: ['shot-1', 'shot-2'],
          prompt: CONTINUOUS_PROMPT,
        }),
      ],
    }))
    expect(storyboardSourceMock.buildStoryboardConsistencySource).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      editScriptId: 'edit-script-1',
      userId: 'user-1',
    })
  })

  it('uses continuous video group planning for the main episode video operation', async () => {
    const operation = createVideoGenerationOperations().generate_episode_videos
    const plan = await operation.plan?.(buildContext(), { episodeId: 'episode-1' })

    expect(plan).toBeDefined()
    expect(plan?.operationId).toBe('generate_episode_videos')
    expect(plan?.tasks).toHaveLength(1)
    expect(plan?.tasks[0]?.taskType).toBe(TASK_TYPE.VIDEO_GROUP)
    expect(plan?.tasks[0]?.target.targetType).toBe('ProjectVideoGroup')
    expect(plan?.tasks[0]?.payload).toEqual(expect.objectContaining({
      videoModel: 'google::veo-test',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      shotIds: ['shot-1', 'shot-2'],
      durationSec: 5,
      generationOptions: expect.objectContaining({
        duration: 5,
      }),
    }))
    expect(plan?.metadata).toEqual(expect.objectContaining({
      chapterIds: ['chapter-1'],
      groupVideoModel: 'google::veo-test',
      videoGroups: [
        expect.objectContaining({
          shotIds: ['shot-1', 'shot-2'],
          shotNumbers: [1, 2],
        }),
      ],
    }))
  })

  it('commits continuous video group records with shot numbers from the edit script', async () => {
    const operation = createVideoGenerationOperations().generate_episode_videos
    const plan = await operation.plan?.(buildContext(), { episodeId: 'episode-1' })

    expect(plan).toBeDefined()
    const result = plan
      ? await operation.commit?.(buildContext(), { episodeId: 'episode-1', confirmed: true }, plan)
      : null

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      total: 1,
      taskIds: ['task-video-group-1'],
    }))
    expect(prismaMock.projectVideoGroup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        gridMode: '2x2',
        shotIds: ['shot-1', 'shot-2'],
        shotNumbers: [1, 2],
        durationSec: 5,
        status: 'queued',
      }),
    })
    expect(prismaMock.projectVideoGroup.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: expect.objectContaining({
        taskId: 'task-video-group-1',
        status: 'queued',
      }),
    })
  })

  it('plans the main episode video operation for every chapter when no chapterId is provided', async () => {
    prismaMock.projectEditChapter.findMany.mockResolvedValueOnce([
      { id: 'chapter-1', chapterIndex: 0 },
      { id: 'chapter-2', chapterIndex: 1 },
    ])
    prismaMock.projectEditScript.findFirst.mockImplementation(async (query: {
      readonly where?: {
        readonly chapterId?: string
      }
    }) => ({
      id: query.where?.chapterId === 'chapter-2' ? 'edit-script-2' : 'edit-script-1',
      corePlanJson: {
        shots: buildShots(),
        generationSegments: [{
          shotIds: ['shot-1', 'shot-2'],
          continuity: 'Hero approaches the chair in one continuous room beat.',
        }],
      },
    }))
    const operation = createVideoGenerationOperations().generate_episode_videos
    const plan = await operation.plan?.(buildContext(), { episodeId: 'episode-1' })

    expect(plan).toBeDefined()
    expect(plan?.tasks).toHaveLength(2)
    expect(plan?.tasks.map((task) => task.payload)).toEqual([
      expect.objectContaining({
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
      }),
      expect.objectContaining({
        episodeId: 'episode-1',
        chapterId: 'chapter-2',
        shotIds: ['shot-1', 'shot-2'],
      }),
    ])
    expect(plan?.metadata).toEqual(expect.objectContaining({
      chapterIds: ['chapter-1', 'chapter-2'],
      items: [
        expect.objectContaining({ chapterId: 'chapter-1' }),
        expect.objectContaining({ chapterId: 'chapter-2' }),
      ],
      groupVideoModel: 'google::veo-test',
    }))
  })

  it('skips existing completed continuous video groups in the main episode video operation', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValueOnce([{
      id: 'video-group-existing',
      status: 'completed',
      taskId: 'task-existing',
      errorCode: null,
      errorMessage: null,
      durationSec: 5,
      prompt: CONTINUOUS_PROMPT,
      referenceImageUrl: null,
      referenceImageMediaId: null,
      videoUrl: 'videos/existing.mp4',
      videoMediaId: null,
      shotIds: ['shot-1', 'shot-2'],
      shotNumbers: [1, 2],
    }])
    const operation = createVideoGenerationOperations().generate_episode_videos
    const plan = await operation.plan?.(buildContext(), { episodeId: 'episode-1' })

    expect(plan).toBeDefined()
    expect(plan?.operationId).toBe('generate_episode_videos')
    expect(plan?.tasks).toEqual([])
    expect(plan?.metadata).toEqual(expect.objectContaining({
      items: [],
      groupVideoModel: 'google::veo-test',
    }))
    const result = plan ? await operation.commit?.(buildContext(), { episodeId: 'episode-1' }, plan) : null
    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      total: 0,
      taskIds: [],
      results: [],
      noop: true,
      reason: 'NO_VIDEO_GROUPS_TO_GENERATE',
    }))
  })
})
