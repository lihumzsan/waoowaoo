import { describe, expect, it } from 'vitest'
import { inspectTaskTargetOwnershipContract } from '../../../scripts/guards/task-target-ownership-guard.mjs'

const valid = {
  schema:
    'model ProjectEditScript { generationTaskId  String? } model ProjectEditShotExecutionPlan { generationTaskId  String? }',
  definitions: `const TASK_DEFINITIONS = {
    [TASK_TYPE.MUSIC_SCORE_PLAN]: definition('music', 'music_score', 'music', 3, 'music_score', 'music_score'),
    [TASK_TYPE.SOUNDSCAPE_PLAN]: definition('music', 'soundscape_plan', 'text', 3, 'soundscape', 'soundscape'),
    [TASK_TYPE.SOUNDSCAPE_GENERATE]: definition('music', 'soundscape_generate', 'sound_effect', 3, 'soundscape', 'soundscape'),
    [TASK_TYPE.EDIT_SCRIPT_GENERATE]: definition('text', 'edit_script_generate', 'text', 3, 'edit_script', 'edit_script'),
    [TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE]: definition('text', 'edit_shot_execution_plan_generate', 'text', 3, 'edit_shot_execution_plan', 'edit_shot_execution_plan'),
    [TASK_TYPE.CHAPTER_RENDER]: definition('video', 'chapter_render', 'none', 1, 'chapter_render', 'chapter_render', 'chapter_render'),
    [TASK_TYPE.FINAL_VIDEO_RENDER]: definition('video', 'final_video_render', 'none', 1, 'final_video_render', 'final_video_render', 'final_video_render'),
    submissionTargetOwnership: 'chapter_render' 'final_video_render',
  }`,
  transactionalCreate: 'claimTaskTargetOwnershipInTransaction',
  projectors:
    "projectMusicScore projectSoundscape projectEditScript projectEditShotExecutionPlan generationTaskId: input.taskId 'success_materialized'",
  editScriptService:
    'generationTaskId: input.taskId EDIT_SCRIPT_TASK_OWNERSHIP_STALE EDIT_SHOT_EXECUTION_PLAN_TASK_OWNERSHIP_STALE',
  videoWorker: 'readCompletedVideoGroupForTask',
  stylePreviewWorker: "preview.status === 'completed'",
  editBibleWorker: 'alreadyPersisted',
  chapterRender: "chapter.renderStatus === 'completed' projectEditChapter.updateMany renderStatus: 'processing' CHAPTER_RENDER_SUCCESS_OWNERSHIP_STALE",
  finalRender: "FINAL_VIDEO_RENDER_OUTPUT_MEDIA_MISSING projectEpisodeFinalOutput.updateMany renderStatus: 'processing' FINAL_VIDEO_RENDER_SUCCESS_OWNERSHIP_STALE",
  bgmWorker: 'readCompletedMusicScoreMix',
  soundscapeWorker: 'readCompletedSoundscapeMix',
  terminalService: "reason: 'completion_pending' TASK_TERMINAL_BUNDLE_MISSING task-lifecycle-broadcast:${event.id}",
  reconciler: 'recoverMaterializedCompletion',
}

describe('Task target ownership guard', () => {
  it('accepts explicit model ownership and exhaustive projectors', () => {
    expect(inspectTaskTargetOwnershipContract(valid)).toEqual([])
  })

  it('rejects a missing owner field or terminal projector', () => {
    expect(
      inspectTaskTargetOwnershipContract({
        ...valid,
        schema: 'model ProjectEditScript {} model ProjectEditShotExecutionPlan {}',
        definitions: '',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('schema missing Task ownership contract'),
        expect.stringContaining('TaskDefinition missing terminal projector'),
      ]),
    )
  })

  it('rejects terminal handling that can overwrite or strand materialized success', () => {
    expect(
      inspectTaskTargetOwnershipContract({
        ...valid,
        terminalService: '',
        reconciler: '',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Terminal Service must preserve'),
        expect.stringContaining('reconciler must resume'),
      ]),
    )
  })

  it('rejects a standalone target failure writer outside Terminal Service', () => {
    expect(inspectTaskTargetOwnershipContract({
      ...valid,
      projectors: `${valid.projectors} export async function syncTaskTargetFailure() {}`,
    })).toContain('target failure projector must not expose a Terminal Service bypass')
  })

  it('rejects terminal replay that does not verify its exact durable broadcast', () => {
    expect(inspectTaskTargetOwnershipContract({
      ...valid,
      terminalService: "reason: 'completion_pending' TASK_TERMINAL_BUNDLE_MISSING",
    })).toContain(
      'Terminal Service idempotent replay must validate its durable bundle: task-lifecycle-broadcast:${event.id}',
    )
  })
})
