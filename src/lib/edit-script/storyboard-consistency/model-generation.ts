import {
  buildStoryboardStillPromptFacts,
} from '@/lib/edit-script/prompt-builders'
import type {
  StoryboardConsistencyGenerationSegment,
  StoryboardConsistencySourceSnapshot,
  StoryboardPanelPromptDraft,
} from './types'

function segmentForShot(
  snapshot: StoryboardConsistencySourceSnapshot,
  shotId: string,
): StoryboardConsistencyGenerationSegment {
  const segment = snapshot.generationSegments.find((item) => item.shotIds.includes(shotId))
  if (!segment) throw new Error(`EDIT_SCRIPT_STORYBOARD_GENERATION_SEGMENT_MISSING:${shotId}`)
  return segment
}

function executionForShot(
  snapshot: StoryboardConsistencySourceSnapshot,
  shotId: string,
) {
  const execution = snapshot.shotExecutionPlan.shots.find((item) => item.shotId === shotId)
  if (!execution) throw new Error(`EDIT_SCRIPT_STORYBOARD_EXECUTION_SHOT_MISSING:${shotId}`)
  return execution
}

export function generateStoryboardPanelPrompts(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
}): readonly StoryboardPanelPromptDraft[] {
  return input.snapshot.shots.map((shot, panelIndex) => {
    const segment = segmentForShot(input.snapshot, shot.shotId)
    const execution = executionForShot(input.snapshot, shot.shotId)
    const built = buildStoryboardStillPromptFacts({
      shot,
      execution,
      styleBible: input.snapshot.styleBible,
    })
    return {
      panelIndex,
      sourceShotId: shot.shotId,
      sourceGenerationSegmentId: segment.sourceGenerationSegmentId,
      prompt: built.prompt,
      videoPrompt: execution.videoPrompt,
      executionSnapshot: execution,
      renderFacts: built.facts,
    }
  })
}
