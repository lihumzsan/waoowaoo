import { describe, expect, it } from 'vitest'
import {
  inspectAssistantFixedWorkflowSurface,
  inspectForbiddenFixedWorkflowPath,
} from '../../../scripts/guards/no-assistant-fixed-workflow-surface.mjs'

describe('no assistant fixed workflow surface guard', () => {
  it('allows generic tooluse operation instructions', () => {
    expect(inspectAssistantFixedWorkflowSurface(
      'src/lib/project-agent/copy.ts',
      'Use the current injected tool definitions to decide whether direct script writing is enough.',
    )).toEqual([])
  })

  it('flags old fixed workflow identifiers', () => {
    expect(inspectAssistantFixedWorkflowSurface(
      'src/lib/project-agent/copy.ts',
      [
        'call create_workflow_plan for story-to-script',
        'operation run_workflow_package writes workflowType',
        'task STORY_TO_SCRIPT_RUN uses /api/runs',
      ].join('\n'),
    )).toEqual([
      'src/lib/project-agent/copy.ts contains story-to-script',
      'src/lib/project-agent/copy.ts contains create_workflow_plan',
      'src/lib/project-agent/copy.ts contains run_workflow_package',
      'src/lib/project-agent/copy.ts contains workflowType',
      'src/lib/project-agent/copy.ts contains STORY_TO_SCRIPT_RUN',
      'src/lib/project-agent/copy.ts contains /api/runs',
    ])
  })

  it('flags old fixed workflow paths', () => {
    expect(inspectForbiddenFixedWorkflowPath('skills/agent', true)).toEqual([
      'skills/agent must not exist',
    ])
    expect(inspectForbiddenFixedWorkflowPath('skills/project-workflow', true)).toEqual([
      'skills/project-workflow must not exist',
    ])
    expect(inspectForbiddenFixedWorkflowPath('skills/project-workflow', false)).toEqual([])
  })
})
