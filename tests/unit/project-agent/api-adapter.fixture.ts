import { beforeEach, describe, expect, it, vi } from 'vitest'

import { z } from 'zod'

import type { NextRequest } from 'next/server'

import { ApiError } from '@/lib/api-errors'

import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'

import { makeTestOperation, EFFECTS_BILLABLE, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'

import { TASK_TYPE } from '@/lib/task/types'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
  createProjectAgentOperationRegistryForApi: () => registryState.registry,
}))

import { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

function buildBillablePlan() {
  return {
    kind: 'task_submission' as const,
    operationId: 'planned_billable_op',
    projectId: 'project-1',
    userId: 'user-1',
    tasks: [{
      id: 'planned-task-1',
      taskType: TASK_TYPE.IMAGE_PANEL,
      target: { targetType: 'ProjectPanel', targetId: 'panel-1' },
      payload: {},
      billingInfo: {
        billable: true as const,
        source: 'task' as const,
        taskType: TASK_TYPE.IMAGE_PANEL,
        apiType: 'image' as const,
        model: 'image-model',
        quantity: 1,
        unit: 'image' as const,
        maxFrozenCost: 1,
        action: TASK_TYPE.IMAGE_PANEL,
        status: 'quoted' as const,
      },
      locale: 'zh' as const,
    }],
  }
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { z } from 'zod'
export type { NextRequest } from 'next/server'
export { ApiError } from '@/lib/api-errors'
export type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
export { makeTestOperation, EFFECTS_BILLABLE, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'
export { TASK_TYPE } from '@/lib/task/types'
export { executeProjectAgentOperationFromApi } from '@/lib/adapters/api/execute-project-agent-operation'
export { buildBillablePlan, buildRequest, registryState }
