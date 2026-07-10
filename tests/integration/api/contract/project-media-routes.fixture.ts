import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const apiAdapterMock = vi.hoisted(() => ({
  executeProjectAgentOperationFromApi: vi.fn(),
}))

const planningMock = vi.hoisted(() => ({
  planProjectAgentOperationFromApi: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1', name: 'Project' },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1', name: 'Project' },
      }
    },
  }
})

vi.mock('@/lib/adapters/api/execute-project-agent-operation', () => apiAdapterMock)

vi.mock('@/lib/operations/planning', () => planningMock)

import { POST as generateVideoPost } from '@/app/api/projects/[projectId]/generate-video/route'

import { POST as finalVideoRenderPost } from '@/app/api/projects/[projectId]/final-video-render/route'

import { POST as regeneratePanelImagePost } from '@/app/api/projects/[projectId]/regenerate-panel-image/route'

import { POST as operationPlanPost } from '@/app/api/projects/[projectId]/operations/[operationId]/plan/route'

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { buildMockRequest } from '../../../helpers/request'
export { POST as generateVideoPost } from '@/app/api/projects/[projectId]/generate-video/route'
export { POST as finalVideoRenderPost } from '@/app/api/projects/[projectId]/final-video-render/route'
export { POST as regeneratePanelImagePost } from '@/app/api/projects/[projectId]/regenerate-panel-image/route'
export { POST as operationPlanPost } from '@/app/api/projects/[projectId]/operations/[operationId]/plan/route'
export { apiAdapterMock, authState, planningMock }
