import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { z } from 'zod'

import type { UIMessage, UIMessageStreamWriter } from 'ai'

import type { NextRequest } from 'next/server'

import { ApiError } from '@/lib/api-errors'

import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'

import { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'

import { TASK_TYPE } from '@/lib/task/types'

import type { OperationPlan } from '@/lib/operations/planning'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))

import { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION

const originalBillingMode = process.env.BILLING_MODE

function buildWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: vi.fn(),
  } as unknown as UIMessageStreamWriter<UIMessage>
}

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export { z } from 'zod'
export type { UIMessage, UIMessageStreamWriter } from 'ai'
export type { NextRequest } from 'next/server'
export { ApiError } from '@/lib/api-errors'
export type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
export { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'
export { TASK_TYPE } from '@/lib/task/types'
export type { OperationPlan } from '@/lib/operations/planning'
export { executeProjectAgentOperationFromTool } from '@/lib/adapters/tools/execute-project-agent-operation'
export { buildRequest, buildWriter, originalBillingMode, originalDeploymentEdition, registryState }
