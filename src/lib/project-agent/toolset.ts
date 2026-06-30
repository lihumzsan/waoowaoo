import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import {
  EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  resolveEditFirstWorkflowCapabilityOperationIds,
} from '@/lib/project-workflow/edit-first'
import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  isEditFirstChoiceToolId,
} from './edit-first-choice-tools'
import type { ProjectAgentContext } from './types'

const CORE_OPERATION_IDS = [
  'ui_cancel',
  'ui_confirm',
  'ui_single_select',
  'ui_multi_select',
  'ui_safety_ack',
  'get_project_phase',
  'get_project_context',
  'get_project_snapshot',
  'get_task_status',
  'get_project_assets',
  'get_project_costs',
  'get_project_data',
  'get_task',
  'list_tasks',
] as const

/**
 * Tool surface for a project agent run.
 *
 * Registration is static per run: every edit-first workflow operation is
 * registered up front so the agent definition (and any serialized RunState)
 * stays stable across the whole run. Availability is live per model turn:
 * each workflow tool carries an isEnabled predicate evaluated against the
 * current workflow state, so when an operation completes mid-run and the
 * workflow advances, the next stage's tool becomes callable on the very next
 * turn — no new run or toolset rebuild required.
 */
export interface ProjectAgentToolset {
  source: 'live-workflow'
  operationIds: string[]
  coreOperationIds: string[]
  workflowOperationIds: string[]
  resumeOperationId: string | null
  includeChoiceOperation: boolean
  disabledOperationIds: string[]
}

function pushOptionalTool(params: {
  registry: ProjectAgentOperationRegistry
  operationIds: string[]
  operationId: string
}) {
  const operation = params.registry[params.operationId]
  if (!operation?.channels.tool) return
  if (!params.operationIds.includes(params.operationId)) {
    params.operationIds.push(params.operationId)
  }
}

function pushRequiredTool(params: {
  registry: ProjectAgentOperationRegistry
  operationIds: string[]
  operationId: string
}) {
  const operation = params.registry[params.operationId]
  if (!operation) {
    throw new Error(`PROJECT_AGENT_REQUIRED_OPERATION_MISSING:${params.operationId}`)
  }
  if (!operation.channels.tool) {
    throw new Error(`PROJECT_AGENT_REQUIRED_OPERATION_NOT_TOOL:${params.operationId}`)
  }
  if (!params.operationIds.includes(params.operationId)) {
    params.operationIds.push(params.operationId)
  }
}

export function resolveProjectAgentToolset(params: {
  registry: ProjectAgentOperationRegistry
  context: ProjectAgentContext
  resumeOperationId?: string | null
  disabledOperationIds?: readonly string[]
}): ProjectAgentToolset {
  const operationIds: string[] = []
  const coreOperationIds: string[] = []
  const workflowOperationIds: string[] = []
  const includeChoiceOperation = Boolean(params.context.episodeId)

  for (const operationId of CORE_OPERATION_IDS) {
    const beforeLength = operationIds.length
    pushOptionalTool({
      registry: params.registry,
      operationIds,
      operationId,
    })
    if (operationIds.length > beforeLength) {
      coreOperationIds.push(operationId)
    }
  }

  if (includeChoiceOperation) {
    for (const operationId of EDIT_FIRST_CHOICE_OPERATION_IDS) {
      const beforeLength = operationIds.length
      pushRequiredTool({
        registry: params.registry,
        operationIds,
        operationId,
      })
      if (operationIds.length > beforeLength) {
        workflowOperationIds.push(operationId)
      }
    }
  }

  for (const operationId of EDIT_FIRST_WORKFLOW_OPERATION_IDS) {
    const beforeLength = operationIds.length
    pushRequiredTool({
      registry: params.registry,
      operationIds,
      operationId,
    })
    if (operationIds.length > beforeLength) {
      workflowOperationIds.push(operationId)
    }
  }

  const resumeOperationId = params.resumeOperationId ?? null
  if (resumeOperationId) {
    const beforeLength = operationIds.length
    pushRequiredTool({
      registry: params.registry,
      operationIds,
      operationId: resumeOperationId,
    })
    if (operationIds.length > beforeLength) {
      workflowOperationIds.push(resumeOperationId)
    }
  }

  return {
    source: 'live-workflow',
    operationIds,
    coreOperationIds,
    workflowOperationIds,
    resumeOperationId,
    includeChoiceOperation,
    disabledOperationIds: Array.from(new Set(params.disabledOperationIds ?? [])),
  }
}

/**
 * Operations whose availability does not depend on the live workflow state:
 * read/UI core tools, edit-first choice cards (their execution validates the
 * fixed choice type against the live workflow stage), and the run's resumed approval operation.
 * A restored approval must stay callable even if the workflow has moved past
 * the stage that originally offered it.
 */
export function isProjectAgentOperationAlwaysEnabled(
  toolset: ProjectAgentToolset,
  operationId: string,
): boolean {
  return toolset.coreOperationIds.includes(operationId)
    || operationId === toolset.resumeOperationId
}

function isEditFirstChoiceOperationEnabled(params: {
  workflow: EditFirstWorkflowState
  operationId: string
}): boolean {
  if (params.operationId === EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio) {
    return params.workflow.stage === 'ready_to_generate_screenplay'
  }
  if (params.operationId === EDIT_FIRST_CHOICE_TOOL_IDS.screenplay_review) {
    return params.workflow.stage === 'screenplay_ready_for_review'
  }
  if (params.operationId === EDIT_FIRST_CHOICE_TOOL_IDS.style) {
    return params.workflow.stage === 'needs_style_choice'
  }
  if (params.operationId === EDIT_FIRST_CHOICE_TOOL_IDS.asset_review) {
    return params.workflow.stage === 'assets_ready_for_review'
  }
  return false
}

/**
 * Live availability of one registered operation against the current workflow
 * state. Evaluated once per model turn (via each tool's isEnabled), so the
 * tool surface the model sees always reflects the project as it is now, not
 * as it was when the run started.
 */
export function isProjectAgentOperationEnabled(params: {
  toolset: ProjectAgentToolset
  workflow: EditFirstWorkflowState
  operationId: string
}): boolean {
  if (params.toolset.disabledOperationIds.includes(params.operationId)) return false
  if (isProjectAgentOperationAlwaysEnabled(params.toolset, params.operationId)) return true
  if (isEditFirstChoiceToolId(params.operationId)) {
    return isEditFirstChoiceOperationEnabled({
      workflow: params.workflow,
      operationId: params.operationId,
    })
  }
  const enabledOperationIds = new Set<string>(resolveEditFirstWorkflowCapabilityOperationIds(params.workflow))
  const nextActionOperationId = params.workflow.nextAction?.operationId ?? null
  if (nextActionOperationId) enabledOperationIds.add(nextActionOperationId)
  return enabledOperationIds.has(params.operationId)
}
