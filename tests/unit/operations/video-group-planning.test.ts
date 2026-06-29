import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot, EditShotExecution } from '@/lib/edit-script/types'
import type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { TASK_TYPE } from '@/lib/task/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

const CONTINUOUS_PROMPT = 'ShotExecutionPlan continuous segment prompt. 16:9, same room and same screen direction. [00:00-00:02] Shot 1: Hero remains screen left of Chair. <room tone continues> [00:02-00:05] Shot 2: Hero moves closer while Chair stays screen center. <floor creak continues>'

const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectPanel: {
    findMany: vi.fn(),
  },
  projectVideoGroup: {
    findMany: vi.fn(),
  },
}))

const storyboardSourceMock = vi.hoisted(() => ({
  buildStoryboardConsistencySource: vi.fn(),
}))

const resolveSystemModelKeyMock = vi.hoisted(() => vi.fn(async () => 'google::veo-test'))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/edit-script/storyboard-consistency/source-snapshot', () => ({
  buildStoryboardConsistencySource: storyboardSourceMock.buildStoryboardConsistencySource,
}))
vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: resolveSystemModelKeyMock,
}))
vi.mock('@/lib/deployment/config', () => ({
  getDeploymentConfig: vi.fn(() => ({ edition: 'self-hosted' })),
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
      shotNumber: 1,
      durationSec: 2,
      scene: { name: 'Test Room' },
      action: 'Hero stands beside the chair.',
      characters: [
        {
          name: 'Hero',
          visibility: 'visible',
          role: 'focus',
          performance: 'holds still beside the chair',
        },
      ],
      keyObjects: [
        { name: 'Chair', role: 'blocking_anchor' },
      ],
      sound: 'room tone',
    },
    {
      shotNumber: 2,
      durationSec: 3,
      scene: { name: 'Test Room' },
      action: 'Hero steps closer to the chair.',
      characters: [
        {
          name: 'Hero',
          visibility: 'visible',
          role: 'focus',
          performance: 'moves closer without reversing screen direction',
        },
      ],
      keyObjects: [
        { name: 'Chair', role: 'blocking_anchor' },
      ],
      sound: 'floor creak',
    },
  ]
}

function buildExecutionShot(shot: EditScriptShot): EditShotExecution {
  return {
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
    videoPrompt: `Single-shot video prompt for shot ${shot.shotNumber}: Hero stays screen left of Chair and preserves the same room axis.`,
  }
}

function buildSegmentExecution(segment: EditGenerationSegment): EditGenerationSegmentExecution {
  return {
    shotNumbers: segment.shotNumbers,
    motionFlow: 'Hero steps closer without a time jump.',
    cameraFlow: 'Locked shot becomes a slow push while keeping the same axis.',
    blockingFlow: 'Hero stays screen left of Chair.',
    visibilityContinuity: 'Hero remains visible and Chair remains the anchor.',
    soundFlow: 'Room tone carries into floor creak.',
    continuityLocks: ['same room', 'same chair', 'same screen direction'],
    continuousVideoPrompt: CONTINUOUS_PROMPT,
  }
}

function buildSourceSnapshot(): StoryboardConsistencySourceSnapshot {
  const shots = buildShots()
  const segment: EditGenerationSegment = {
    shotNumbers: [1, 2],
    continuity: 'Hero approaches the chair in one continuous room beat.',
  }
  return {
    projectId: 'project-1',
    episodeId: 'episode-1',
    project: { videoRatio: '16:9' },
    editScript: {
      id: 'edit-script-1',
      durationSec: 5,
      shotCount: 2,
      userPrompt: 'test',
      screenplayText: 'test screenplay',
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
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      id: 'edit-script-1',
      corePlanJson: {
        shots: sourceSnapshot.shots,
        generationSegments: sourceSnapshot.generationSegments.map(({ shotNumbers, continuity }) => ({
          shotNumbers,
          continuity,
        })),
      },
    })
    prismaMock.projectPanel.findMany.mockResolvedValue([
      { id: 'panel-1', panelNumber: 1, imageUrl: 'images/panel-1.png', imageMediaId: null },
      { id: 'panel-2', panelNumber: 2, imageUrl: 'images/panel-2.png', imageMediaId: null },
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
      shotNumbers: [1, 2],
    })

    expect(planned.task.taskType).toBe(TASK_TYPE.VIDEO_GROUP)
    expect(planned.task.payload).toEqual(expect.objectContaining({
      videoModel: 'google::veo-test',
      episodeId: 'episode-1',
      gridMode: '2x2',
      shotNumbers: [1, 2],
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
      editScriptId: 'edit-script-1',
      userId: 'user-1',
    })
  })
})
