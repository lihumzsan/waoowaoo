import { describe, expect, it } from 'vitest'

import { z } from 'zod'

import {
  isProjectAgentOperationAlwaysEnabled,
  isProjectAgentOperationEnabled,
  resolveProjectAgentToolset,
} from '@/lib/project-agent/toolset'

import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'

import type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

import { EDIT_FIRST_WORKFLOW_OPERATION_IDS } from '@/lib/project-workflow/edit-first'

import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  isEditFirstChoiceToolId,
} from '@/lib/project-agent/edit-first-choice-tools'

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
        }
      : null,
    allowedOperationIds: operationIds as EditFirstWorkflowState['allowedOperationIds'],
  }
}

function registry(): ProjectAgentOperationRegistry {
  const ids = [
    'get_project_context',
    'get_project_snapshot',
    'get_episode_overview',
    'get_chapter_detail',
    'get_task',
    'get_task_batch',
    'list_tasks',
    ...EDIT_FIRST_CHOICE_OPERATION_IDS,
    ...EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  ]
  return Object.fromEntries(ids.map((id) => [
    id,
    makeOperation(id, id.startsWith('get_') || isEditFirstChoiceToolId(id) ? 'query' : 'act'),
  ]))
}

export { describe, expect, it } from 'vitest'
export { z } from 'zod'
export { isProjectAgentOperationAlwaysEnabled, isProjectAgentOperationEnabled, resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
export type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
export type { EditFirstWorkflowOperationId, EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
export { EDIT_FIRST_WORKFLOW_OPERATION_IDS } from '@/lib/project-workflow/edit-first'
export { EDIT_FIRST_CHOICE_OPERATION_IDS, EDIT_FIRST_CHOICE_TOOL_IDS, isEditFirstChoiceToolId } from '@/lib/project-agent/edit-first-choice-tools'
export { EFFECTS_BILLABLE, EFFECTS_NONE, makeTestOperation } from '../../helpers/project-agent-operations'
export { makeOperation, registry, workflow }
