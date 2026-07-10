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

export type { NextRequest } from 'next/server'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export type { EditGenerationSegment, EditGenerationSegmentExecution, EditScriptShot, EditShotExecution } from '@/lib/edit-script/types'
export type { StoryboardConsistencySourceSnapshot } from '@/lib/edit-script/storyboard-consistency/types'
export type { ProjectAgentOperationContext } from '@/lib/operations/types'
export { TASK_TYPE } from '@/lib/task/types'
export { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'
export { createVideoGenerationOperations } from '@/lib/operations/domains/storyboard/generation/video'
export { planVideoGroupTask } from '@/lib/operations/domains/storyboard/generation/video/video-group-planning'
export { CONTINUOUS_PROMPT, buildContext, buildExecutionShot, buildSegmentExecution, buildShots, buildSourceSnapshot, prismaMock, resolveSystemModelKeyMock, storyboardSourceMock, submitOperationTaskMock }
