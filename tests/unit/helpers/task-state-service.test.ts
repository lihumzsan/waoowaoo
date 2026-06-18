import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  asBoolean,
  asNonEmptyString,
  asObject,
  buildIdleState,
  extractStoryboardGridPanelIds,
  pairKey,
  queryTaskTargetStates,
  resolveTargetState,
  toProgress,
} from '@/lib/task/state-service'

describe('task state service helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes primitive parsing helpers', () => {
    expect(pairKey('A', 'B')).toBe('A:B')
    expect(asObject({ ok: true })).toEqual({ ok: true })
    expect(asObject(['x'])).toBeNull()
    expect(asNonEmptyString(' x ')).toBe('x')
    expect(asNonEmptyString('  ')).toBeNull()
    expect(asBoolean(true)).toBe(true)
    expect(asBoolean('true')).toBeNull()
    expect(toProgress(101)).toBe(100)
    expect(toProgress(-5)).toBe(0)
    expect(toProgress(Number.NaN)).toBeNull()
    expect(
      extractStoryboardGridPanelIds({
        storyboardGrid: {
          panelIds: ['panel-1', 'panel-2', 'panel-2', '', 123],
        },
      }),
    ).toEqual(['panel-1', 'panel-2'])
  })

  it('builds idle state when no tasks found', () => {
    const idle = buildIdleState({ targetType: 'GlobalCharacter', targetId: 'c1' })
    expect(idle.phase).toBe('idle')
    expect(idle.runningTaskId).toBeNull()
    expect(idle.lastError).toBeNull()
  })

  it('resolves processing state from active task', () => {
    const state = resolveTargetState(
      { targetType: 'GlobalCharacter', targetId: 'c1' },
      [
        {
          id: 'task-1',
          type: 'asset_hub_image',
          status: 'processing',
          progress: 42,
          payload: {
            stage: 'image_generating',
            stageLabel: 'Generating',
            ui: { intent: 'create', hasOutputAtStart: false },
          },
          errorCode: null,
          errorMessage: null,
          operationId: 'generate_character_image',
          operationRequestId: 'request-1',
          updatedAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('processing')
    expect(state.runningTaskId).toBe('task-1')
    expect(state.progress).toBe(42)
    expect(state.progressGroupId).toBe('operation:generate_character_image:request-1')
    expect(state.stage).toBe('image_generating')
    expect(state.stageLabel).toBe('Generating')
  })

  it('prefers explicit payload progress group over operation metadata', () => {
    const state = resolveTargetState(
      { targetType: 'ProjectPanel', targetId: 'panel-1' },
      [
        {
          id: 'task-1',
          type: TASK_TYPE.IMAGE_PANEL,
          status: 'processing',
          progress: 10,
          payload: {
            ui: {
              intent: 'generate',
              progressGroupId: 'operation:custom-group:request-1',
            },
          },
          errorCode: null,
          errorMessage: null,
          operationId: 'generate_edit_script_storyboard_images',
          operationRequestId: 'request-2',
          updatedAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    )

    expect(state.progressGroupId).toBe('operation:custom-group:request-1')
  })

  it('resolves failed state and normalizes error', () => {
    const state = resolveTargetState(
      { targetType: 'GlobalCharacter', targetId: 'c1' },
      [
        {
          id: 'task-2',
          type: 'asset_hub_image',
          status: 'failed',
          progress: 100,
          payload: { ui: { intent: 'modify', hasOutputAtStart: true } },
          errorCode: 'INVALID_PARAMS',
          errorMessage: 'bad input',
          updatedAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('failed')
    expect(state.runningTaskId).toBeNull()
    expect(state.lastError?.code).toBe('INVALID_PARAMS')
    expect(state.lastError?.message).toBe('bad input')
  })

  it('treats canceled task as failed presentation state', () => {
    const state = resolveTargetState(
      { targetType: 'GlobalCharacter', targetId: 'c1' },
      [
        {
          id: 'task-3',
          type: 'asset_hub_image',
          status: 'canceled',
          progress: 100,
          payload: { ui: { intent: 'modify', hasOutputAtStart: true } },
          errorCode: 'TASK_CANCELLED',
          errorMessage: 'Task cancelled by user',
          updatedAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('failed')
    expect(state.lastError?.code).toBe('CONFLICT')
    expect(state.lastError?.message).toBe('Task cancelled by user')
  })

  it('projects storyboard grid image task state to every covered panel target', async () => {
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: 'task-grid-1',
        type: TASK_TYPE.IMAGE_PANEL,
        status: 'processing',
        progress: 35,
        payload: {
          storyboardGrid: {
            mode: '2x2',
            panelIds: ['panel-1', 'panel-2', 'panel-3'],
          },
          ui: {
            intent: 'create',
            hasOutputAtStart: false,
          },
        },
        errorCode: null,
        errorMessage: null,
        targetType: 'ProjectPanel',
        targetId: 'panel-1',
        operationId: 'generate_edit_script_storyboard_images',
        operationRequestId: 'request-grid-1',
        updatedAt: new Date('2026-06-17T08:00:00.000Z'),
      },
    ])

    const states = await queryTaskTargetStates({
      projectId: 'project-1',
      userId: 'user-1',
      targets: [
        { targetType: 'ProjectPanel', targetId: 'panel-2', types: [TASK_TYPE.IMAGE_PANEL] },
        { targetType: 'ProjectPanel', targetId: 'panel-3', types: [TASK_TYPE.IMAGE_PANEL] },
      ],
    })

    expect(states).toMatchObject([
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-2',
        phase: 'processing',
        runningTaskId: 'task-grid-1',
        runningTaskType: TASK_TYPE.IMAGE_PANEL,
        progressGroupId: 'operation:generate_edit_script_storyboard_images:request-grid-1',
        progress: 35,
      },
      {
        targetType: 'ProjectPanel',
        targetId: 'panel-3',
        phase: 'processing',
        runningTaskId: 'task-grid-1',
        runningTaskType: TASK_TYPE.IMAGE_PANEL,
        progressGroupId: 'operation:generate_edit_script_storyboard_images:request-grid-1',
        progress: 35,
      },
    ])
  })
})
