import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { resolveEditFirstWorkflowCapabilityOperationIds } from '@/lib/project-workflow/edit-first'
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
  'get_project_command',
  'list_recent_commands',
  'list_skill_catalog',
  'list_saved_skills',
  'get_project_assets',
  'get_project_costs',
  'get_project_data',
  'get_task',
  'list_tasks',
] as const

const EDIT_FIRST_CHOICE_OPERATION_ID = 'request_edit_first_choice'

export interface ProjectAgentToolset {
  source: 'deterministic-workflow'
  operationIds: string[]
  coreOperationIds: string[]
  workflowOperationIds: string[]
  continuationOperationId: string | null
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
  workflow: EditFirstWorkflowState
  context: ProjectAgentContext
  continuationOperationId?: string | null
}): ProjectAgentToolset {
  const operationIds: string[] = []
  const coreOperationIds: string[] = []
  const workflowOperationIds: string[] = []

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

  if (params.context.episodeId) {
    const beforeLength = operationIds.length
    pushRequiredTool({
      registry: params.registry,
      operationIds,
      operationId: EDIT_FIRST_CHOICE_OPERATION_ID,
    })
    if (operationIds.length > beforeLength) {
      workflowOperationIds.push(EDIT_FIRST_CHOICE_OPERATION_ID)
    }
  }

  const workflowCapabilityOperationIds = resolveEditFirstWorkflowCapabilityOperationIds(params.workflow)
  for (const operationId of workflowCapabilityOperationIds) {
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

  const nextOperationId = params.workflow.nextAction?.operationId ?? null
  if (nextOperationId) {
    const beforeLength = operationIds.length
    pushRequiredTool({
      registry: params.registry,
      operationIds,
      operationId: nextOperationId,
    })
    if (operationIds.length > beforeLength) {
      workflowOperationIds.push(nextOperationId)
    }
  }

  const continuationOperationId = params.continuationOperationId ?? null
  if (continuationOperationId) {
    const beforeLength = operationIds.length
    pushRequiredTool({
      registry: params.registry,
      operationIds,
      operationId: continuationOperationId,
    })
    if (operationIds.length > beforeLength) {
      workflowOperationIds.push(continuationOperationId)
    }
  }

  return {
    source: 'deterministic-workflow',
    operationIds,
    coreOperationIds,
    workflowOperationIds,
    continuationOperationId,
  }
}
