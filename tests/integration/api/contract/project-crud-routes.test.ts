import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authState,
  crudRoutes,
  invokeRouteMethod,
  prismaMock,
  resetCrudMocks,
  type RouteMethod,
} from '../helpers/crud-contract'

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
    requireProjectAuth: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

describe('api contract - project crud routes (behavior)', () => {
  const projectRoutes = crudRoutes.filter((entry) =>
    entry.routeFile.includes('/projects/[projectId]/panel/')
    || entry.routeFile.includes('/projects/[projectId]/storyboards/'),
  )

  beforeEach(() => {
    resetCrudMocks()
  })

  it('all project crud route methods reject unauthenticated requests (no 2xx pass-through)', async () => {
    const methods: ReadonlyArray<RouteMethod> = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
    let checkedMethodCount = 0

    for (const entry of projectRoutes) {
      const modulePath = `@/${entry.routeFile.replace(/^src\//, '').replace(/\.ts$/, '')}`
      const mod = await import(modulePath)
      for (const method of methods) {
        if (typeof mod[method] !== 'function') continue
        checkedMethodCount += 1
        const res = await invokeRouteMethod(entry.routeFile, method)
        expect(res.status, `${entry.routeFile}#${method} should reject unauthenticated`).toBeGreaterThanOrEqual(400)
        expect(res.status, `${entry.routeFile}#${method} should not be server-error on auth gate`).toBeLessThan(500)
      }
    }

    expect(checkedMethodCount).toBeGreaterThan(0)
  })

})
