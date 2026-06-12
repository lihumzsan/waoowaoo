import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'

function makeOperation(id: string, intent: 'query' | 'plan' | 'act' = 'query') {
  return makeTestOperation({
    id,
    summary: id,
    intent,
    groupPath: id.startsWith('get_') || id.startsWith('list_') ? ['project', 'read'] : ['edit-script'],
    effects: intent === 'act' ? EFFECTS_BILLABLE : EFFECTS_NONE,
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    execute: async () => ({}),
  })
}

function workflow(stage: EditFirstWorkflowState['stage'], operationIds: string[]): EditFirstWorkflowState {
  const operationId = operationIds[0]
  return {
    active: true,
    stage,
    blocking: {
      kind: operationId ? 'needs_confirmation' : 'none',
      reason: null,
    },
    nextAction: operationId
      ? {
          id: operationId,
          operationId: operationId as EditFirstWorkflowOperationId,
          title: operationId,
          requiresUserConfirmation: true,
        }
      : null,
    allowedOperationIds: operationIds as EditFirstWorkflowState['allowedOperationIds'],
  }
}

function registry(): ProjectAgentOperationRegistry {
  const ids = [
    'get_project_phase',
    'get_project_context',
    'get_project_snapshot',
    'get_task_status',
    'request_edit_first_choice',
    'generate_edit_screenplay',
    'revise_edit_screenplay',
    'generate_edit_style_previews',
    'generate_edit_director_decoupage',
    'generate_edit_script',
    'generate_edit_script_assets',
    'generate_edit_cinematography_shot_plan',
    'generate_edit_script_storyboard',
    'generate_edit_script_storyboard_images',
    'generate_episode_videos',
    'render_final_video',
  ]
  return Object.fromEntries(ids.map((id) => [
    id,
    makeOperation(id, id.startsWith('get_') ? 'query' : id === 'request_edit_first_choice' ? 'query' : 'act'),
  ]))
}

describe('project agent deterministic toolset', () => {
  it('injects choice, read tools, and screenplay generation for a new edit-first episode', () => {
    const result = resolveProjectAgentToolset({
      registry: registry(),
      workflow: workflow('ready_to_generate_screenplay', ['generate_edit_screenplay']),
      context: { episodeId: 'episode-1' },
    })

    expect(result.operationIds).toEqual(expect.arrayContaining([
      'get_project_phase',
      'get_project_context',
      'request_edit_first_choice',
      'generate_edit_screenplay',
    ]))
  })

  it('keeps script asset generation visible in ready_to_generate_assets', () => {
    const result = resolveProjectAgentToolset({
      registry: registry(),
      workflow: workflow('ready_to_generate_assets', ['generate_edit_script_assets']),
      context: { episodeId: 'episode-1' },
    })

    expect(result.operationIds).toContain('generate_edit_script_assets')
    expect(result.operationIds).not.toContain('generate_edit_screenplay')
  })

  it('exposes storyboard image generation before video generation', () => {
    const result = resolveProjectAgentToolset({
      registry: registry(),
      workflow: workflow('ready_to_generate_storyboard_images', ['generate_edit_script_storyboard_images']),
      context: { episodeId: 'episode-1' },
    })

    expect(result.operationIds).toContain('generate_edit_script_storyboard_images')
    expect(result.operationIds).not.toContain('generate_episode_videos')
  })

  it('fails explicitly when a workflow stage references a missing required operation', () => {
    const missingRegistry = registry()
    delete missingRegistry.generate_edit_script_assets

    expect(() => resolveProjectAgentToolset({
      registry: missingRegistry,
      workflow: workflow('ready_to_generate_assets', ['generate_edit_script_assets']),
      context: { episodeId: 'episode-1' },
    })).toThrow('PROJECT_AGENT_REQUIRED_OPERATION_MISSING:generate_edit_script_assets')
  })
})
