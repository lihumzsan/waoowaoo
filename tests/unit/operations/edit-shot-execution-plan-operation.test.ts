import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { TASK_TYPE } from '@/lib/task/types'

const taskSubmissionMock = vi.hoisted(() => ({
  submitProjectEditScriptGenerationTask: vi.fn(),
  submitProjectEditShotExecutionPlanTask: vi.fn(async () => ({
    success: true,
    async: true,
    taskId: 'task-single',
    status: 'queued',
    runId: null,
    deduped: false,
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    editScriptId: 'script-1',
    taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
    targetType: 'ProjectEditScript',
    targetId: 'script-1',
  })),
  submitProjectEditShotExecutionPlanBatchTasks: vi.fn(async () => ({
    success: true,
    async: true,
    episodeId: 'episode-1',
    batchKey: 'edit_shot_execution_plan_generate:batch-1',
    total: 2,
    taskIds: ['task-2', 'task-3'],
    results: [
      {
        refId: 'script-2',
        taskId: 'task-2',
        taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
        targetType: 'ProjectEditScript',
        targetId: 'script-2',
      },
      {
        refId: 'script-3',
        taskId: 'task-3',
        taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
        targetType: 'ProjectEditScript',
        targetId: 'script-3',
      },
    ],
    submittedTasks: [
      {
        chapterId: 'chapter-2',
        editScriptId: 'script-2',
        taskId: 'task-2',
        status: 'queued',
        runId: null,
        deduped: false,
        taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
        targetType: 'ProjectEditScript',
        targetId: 'script-2',
      },
      {
        chapterId: 'chapter-3',
        editScriptId: 'script-3',
        taskId: 'task-3',
        status: 'queued',
        runId: null,
        deduped: false,
        taskType: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
        targetType: 'ProjectEditScript',
        targetId: 'script-3',
      },
    ],
  })),
  submitProjectEditStylePreviewsGenerationTask: vi.fn(),
}))

vi.mock('@/lib/edit-script/task-submission', () => taskSubmissionMock)

vi.mock('@/lib/task/batch', () => ({
  createTaskBatchKey: vi.fn(() => 'edit_shot_execution_plan_generate:batch-1'),
  readLatestFailedTaskBatchKeyForTarget: vi.fn(async () => null),
}))

vi.mock('@/lib/edit-script/service', () => ({
  generateProjectEditScriptAssets: vi.fn(),
}))

vi.mock('@/lib/edit-script/asset-revision', () => ({
  reviseProjectEditScriptAssets: vi.fn(),
}))

vi.mock('@/lib/edit-bible', async () => {
  const { z } = await import('zod')
  return {
    ingestEditBibleScriptInputSchema: z.object({ confirmed: z.boolean().optional() }).passthrough(),
    reviseEditBibleInputSchema: z.object({ confirmed: z.boolean().optional() }).passthrough(),
    confirmEditBibleInputSchema: z.object({ confirmed: z.boolean().optional() }).passthrough(),
    getEditBibleInputSchema: z.object({}).passthrough(),
    getEditChaptersInputSchema: z.object({}).passthrough(),
    confirmEpisodeEditBible: vi.fn(),
    readEpisodeEditBible: vi.fn(),
    readEpisodeEditChapters: vi.fn(),
    reviseEpisodeEditBible: vi.fn(),
    submitProjectEditBibleGenerationTask: vi.fn(),
  }
})

vi.mock('@/lib/edit-script/replan-guard', () => ({
  assertChapterReplanHasNoRunningVideoGroups: vi.fn(),
}))

vi.mock('@/lib/edit-script/storyboard-consistency/service', () => ({
  submitEditScriptStoryboardPanels: vi.fn(),
}))

vi.mock('@/lib/project-agent/choice-card', () => ({
  buildEditFirstAssistantChoiceCard: vi.fn(),
}))

vi.mock('@/lib/project-agent/interruptions', () => ({
  settleProjectAgentInterruptionSuspension: vi.fn(),
}))

vi.mock('@/lib/project-workflow/edit-first', () => ({
  resolveEditFirstWorkflowState: vi.fn(),
}))

vi.mock('@/lib/edit-script/task-billing', () => ({
  buildEditFirstTextTaskPayload: vi.fn(async (input: { readonly payload: Record<string, unknown> }) => input.payload),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

import { createEditScriptOperations } from '@/lib/operations/domains/media/edit-script-ops'

function buildContext(source: string): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: {
      episodeId: 'episode-1',
      locale: 'zh',
    },
    source,
    writer: null,
  }
}

describe('edit shot execution plan operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses episode batch submission for assistant calls even when runtime scope injects editScriptId', async () => {
    const operation = createEditScriptOperations().generate_edit_shot_execution_plan
    const result = await operation.execute!(buildContext('assistant-panel'), {
      episodeId: 'episode-1',
      editScriptId: 'script-1',
    })

    expect(taskSubmissionMock.submitProjectEditShotExecutionPlanBatchTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        batchKey: 'edit_shot_execution_plan_generate:batch-1',
        source: 'assistant-panel',
        locale: 'zh',
      }),
    )
    expect(taskSubmissionMock.submitProjectEditShotExecutionPlanTask).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        async: true,
        total: 2,
        taskIds: ['task-2', 'task-3'],
      }),
    )
  })

  it('keeps explicit non-assistant scoped calls on the single-script path', async () => {
    const operation = createEditScriptOperations().generate_edit_shot_execution_plan
    const result = await operation.execute!(buildContext('project-ui'), {
      episodeId: 'episode-1',
      editScriptId: 'script-1',
    })

    expect(taskSubmissionMock.submitProjectEditShotExecutionPlanTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        userId: 'user-1',
        episodeId: 'episode-1',
        editScriptId: 'script-1',
        source: 'project-ui',
        locale: 'zh',
      }),
    )
    expect(taskSubmissionMock.submitProjectEditShotExecutionPlanBatchTasks).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        async: true,
        taskId: 'task-single',
        editScriptId: 'script-1',
      }),
    )
  })
})
