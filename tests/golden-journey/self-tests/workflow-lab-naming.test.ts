import { describe, expect, it } from 'vitest'
import { PROJECT_NAME_MAX_LENGTH } from '@/lib/projects/validation'
import { buildWorkflowLabProjectName } from '@/lib/workflow-lab/naming'

describe('Workflow Lab checkpoint project naming', () => {
  it('keeps repeated real checkpoint forks within the shared project-name contract', () => {
    const now = new Date('2026-07-12T00:00:00.000Z')
    let sourceName = 'A deterministic source project'
    for (const stage of [
      'script_ready_for_review',
      'bible_ready_for_review',
      'needs_style_choice',
      'assets_ready_for_review',
      'ready_to_generate_videos',
      'completed',
    ]) {
      sourceName = buildWorkflowLabProjectName({ sourceName, stage, now })
      expect(sourceName.length).toBeLessThanOrEqual(PROJECT_NAME_MAX_LENGTH)
      expect(sourceName).toContain(`[LAB] ${stage} - `)
      expect(sourceName).toContain('2026-07-12 00:00:00')
    }
  })
})
