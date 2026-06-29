import {
  buildStoryboardPanelVideoPrompt,
  buildStoryboardStillPromptFacts,
} from '@/lib/edit-script/prompt-builders'
import type {
  StoryboardConsistencyGenerationSegment,
  StoryboardConsistencySourceSnapshot,
  StoryboardPanelPromptDraft,
} from './types'

function segmentForShot(
  snapshot: StoryboardConsistencySourceSnapshot,
  shotNumber: number,
): StoryboardConsistencyGenerationSegment {
  const segment = snapshot.generationSegments.find((item) => item.shotNumbers.includes(shotNumber))
  if (!segment) throw new Error(`EDIT_SCRIPT_STORYBOARD_GENERATION_SEGMENT_MISSING:${shotNumber}`)
  return segment
}

function executionForShot(
  snapshot: StoryboardConsistencySourceSnapshot,
  shotNumber: number,
) {
  const execution = snapshot.shotExecutionPlan.shots.find((item) => item.shotNumber === shotNumber)
  if (!execution) throw new Error(`EDIT_SCRIPT_STORYBOARD_EXECUTION_SHOT_MISSING:${shotNumber}`)
  return execution
}

export function generateStoryboardPanelPrompts(input: {
  readonly snapshot: StoryboardConsistencySourceSnapshot
}): readonly StoryboardPanelPromptDraft[] {
  return input.snapshot.shots.map((shot, panelIndex) => {
    const segment = segmentForShot(input.snapshot, shot.shotNumber)
    const execution = executionForShot(input.snapshot, shot.shotNumber)
    const built = buildStoryboardStillPromptFacts({
      shot,
      execution,
      styleBible: input.snapshot.styleBible,
    })
    return {
      panelIndex,
      sourceShotNumber: shot.shotNumber,
      sourceGenerationSegmentId: segment.sourceGenerationSegmentId,
      prompt: built.prompt,
      videoPrompt: buildStoryboardPanelVideoPrompt({
        facts: built.facts,
        shot,
        execution,
        styleBible: input.snapshot.styleBible,
      }),
      executionSnapshot: execution,
      renderFacts: built.facts,
    }
  })
}
