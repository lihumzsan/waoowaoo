import { describe, expect, it } from 'vitest'
import {
  asBoolean,
  asNonEmptyString,
  asObject,
  buildIdleState,
  pairKey,
  resolveTargetState,
  toProgress,
} from '@/lib/task/state-service'

describe('task state service helpers', () => {
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
          updatedAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('processing')
    expect(state.runningTaskId).toBe('task-1')
    expect(state.progress).toBe(42)
    expect(state.stage).toBe('image_generating')
    expect(state.stageLabel).toBe('Generating')
    expect(state.batch).toBeNull()
  })

  it('aggregates active child tasks from the newest image batch', () => {
    const state = resolveTargetState(
      { targetType: 'LocationImage', targetId: 'location-1' },
      [
        {
          id: 'task-completed',
          type: 'image_location',
          status: 'completed',
          progress: 100,
          payload: { batch: { id: 'batch-1', index: 0, total: 3 } },
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date('2026-07-11T00:03:00.000Z'),
        },
        {
          id: 'task-processing',
          type: 'image_location',
          status: 'processing',
          progress: 50,
          payload: { batch: { id: 'batch-1', index: 1, total: 3 } },
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date('2026-07-11T00:02:00.000Z'),
        },
        {
          id: 'task-queued',
          type: 'image_location',
          status: 'queued',
          progress: 0,
          payload: { batch: { id: 'batch-1', index: 2, total: 3 } },
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date('2026-07-11T00:01:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('processing')
    expect(state.progress).toBe(50)
    expect(state.batch).toEqual({
      id: 'batch-1',
      total: 3,
      queued: 1,
      processing: 1,
      completed: 1,
      failed: 0,
      failedIndexes: [],
    })
  })

  it('reports partial batch failure after every child becomes terminal', () => {
    const state = resolveTargetState(
      { targetType: 'CharacterAppearance', targetId: 'appearance-1' },
      [
        {
          id: 'task-failed',
          type: 'image_character',
          status: 'failed',
          progress: 45,
          payload: { batch: { id: 'batch-2', index: 1, total: 2 } },
          errorCode: 'GENERATION_TIMEOUT',
          errorMessage: 'timed out',
          updatedAt: new Date('2026-07-11T00:02:00.000Z'),
        },
        {
          id: 'task-completed',
          type: 'image_character',
          status: 'completed',
          progress: 100,
          payload: { batch: { id: 'batch-2', index: 0, total: 2 } },
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date('2026-07-11T00:01:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('failed')
    expect(state.lastError?.message).toBe('timed out')
    expect(state.batch).toEqual({
      id: 'batch-2',
      total: 2,
      queued: 0,
      processing: 0,
      completed: 1,
      failed: 1,
      failedIndexes: [1],
    })
  })

  it('keeps an incompletely submitted batch queued instead of reporting completion', () => {
    const state = resolveTargetState(
      { targetType: 'LocationImage', targetId: 'location-1' },
      [{
        id: 'task-completed',
        type: 'image_location',
        status: 'completed',
        progress: 100,
        payload: { batch: { id: 'batch-3', index: 0, total: 3 } },
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date('2026-07-11T00:01:00.000Z'),
      }],
    )

    expect(state.phase).toBe('queued')
    expect(state.progress).toBe(33)
    expect(state.batch?.completed).toBe(1)
    expect(state.batch?.total).toBe(3)
  })

  it('uses only the newest task for each index when a terminal batch is retried', () => {
    const state = resolveTargetState(
      { targetType: 'LocationImage', targetId: 'location-1' },
      [
        {
          id: 'retry-index-0',
          type: 'image_location',
          status: 'processing',
          progress: 40,
          payload: { batch: { id: 'batch-stable', index: 0, total: 2 } },
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date('2026-07-11T00:03:00.000Z'),
        },
        {
          id: 'retry-index-1',
          type: 'image_location',
          status: 'queued',
          progress: 0,
          payload: { batch: { id: 'batch-stable', index: 1, total: 2 } },
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date('2026-07-11T00:02:00.000Z'),
        },
        {
          id: 'old-failed-index-0',
          type: 'image_location',
          status: 'failed',
          progress: 20,
          payload: { batch: { id: 'batch-stable', index: 0, total: 2 } },
          errorCode: 'GENERATION_TIMEOUT',
          errorMessage: 'old failure',
          updatedAt: new Date('2026-07-11T00:01:00.000Z'),
        },
      ],
    )

    expect(state.phase).toBe('processing')
    expect(state.batch).toEqual({
      id: 'batch-stable',
      total: 2,
      queued: 1,
      processing: 1,
      completed: 0,
      failed: 0,
      failedIndexes: [],
    })
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
})
