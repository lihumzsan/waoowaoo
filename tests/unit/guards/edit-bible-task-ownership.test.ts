import { describe, expect, it } from 'vitest'
import { inspectEditBibleTaskOwnershipContract } from '../../../scripts/guards/edit-bible-task-ownership-guard.mjs'

const valid = {
  schema: 'generationTaskId\n@@index([generationTaskId])',
  submission: 'onTaskCreatedInTransaction\ndata: { generationTaskId: task.id }',
  failureProjector: "generationTaskId: input.taskId\nstatus: 'generating'",
  successProjector: 'readonly taskId: string\ngenerationTaskId: input.taskId\nFOR UPDATE\nEDIT_BIBLE_GENERATION_OWNERSHIP_STALE\nEDIT_BIBLE_GENERATION_FINAL_CAS_FAILED',
  taskDefinition: 'terminalSuccessHandoff\nterminalFailureProjector\nterminalCancelProjector',
  terminalService: 'projectTaskTargetTerminalInTransaction(tx,\nkind: intent.kind',
  legacyParentSources: ['', '', '', ''],
  stylePreviewWorker: 'taskId: job.data.taskId\nEDIT_STYLE_PREVIEW_TASK_OWNERSHIP_STALE',
  videoWorker: 'taskId: job.data.taskId\nVIDEO_GROUP_TASK_OWNERSHIP_STALE',
}

describe('edit bible Task ownership guard', () => {
  it('accepts atomic ownership with fenced success and failure projectors', () => {
    expect(inspectEditBibleTaskOwnershipContract(valid)).toEqual([])
  })

  it('rejects the legacy silent failure skip', () => {
    expect(inspectEditBibleTaskOwnershipContract({
      ...valid,
      failureProjector: `${valid.failureProjector}\nProjectEditBible currently has no task ownership field`,
    })).toContain('legacy unfenced ProjectEditBible failure skip must remain deleted')
  })
})
