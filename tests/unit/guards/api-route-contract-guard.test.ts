import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

function runGuard<T>(code: string): T {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return JSON.parse(output) as T
}

describe('api route contract guard', () => {
  it('allows explicit public and framework-managed exceptions', () => {
    const result = runGuard<{
      hasApiAllowlist: boolean
      hasPublicAllowlist: boolean
      violations: string[]
    }>(`
      import { API_HANDLER_ALLOWLIST, PUBLIC_ROUTE_ALLOWLIST, inspectRouteContract } from './scripts/guards/api-route-contract-guard.mjs'
      console.log(JSON.stringify({
        hasApiAllowlist: API_HANDLER_ALLOWLIST.has('src/app/api/auth/[...nextauth]/route.ts'),
        hasPublicAllowlist: PUBLIC_ROUTE_ALLOWLIST.has('src/app/api/system/boot-id/route.ts'),
        violations: inspectRouteContract(
          'src/app/api/system/boot-id/route.ts',
          'export async function GET() { return Response.json({ bootId: "x" }) }',
        ),
      }))
    `)

    expect(result.hasApiAllowlist).toBe(true)
    expect(result.hasPublicAllowlist).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('passes protected routes that use apiHandler and explicit auth', () => {
    const content = `
      import { requireUserAuth } from '@/lib/api-auth'
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => {
        await requireUserAuth()
        return Response.json({ ok: true })
      })
    `

    const result = runGuard<string[]>(`
      import { inspectRouteContract } from './scripts/guards/api-route-contract-guard.mjs'
      console.log(JSON.stringify(inspectRouteContract('src/app/api/user/secure/route.ts', ${JSON.stringify(content)})))
    `)

    expect(result).toEqual([])
  })

  it('flags protected routes that skip apiHandler or auth', () => {
    const missingApiHandler = `
      import { requireUserAuth } from '@/lib/api-auth'
      export async function GET() {
        await requireUserAuth()
        return Response.json({ ok: true })
      }
    `
    const missingAuth = `
      import { apiHandler } from '@/lib/api-errors'
      export const GET = apiHandler(async () => Response.json({ ok: true }))
    `

    const missingApiHandlerResult = runGuard<string[]>(`
      import { inspectRouteContract } from './scripts/guards/api-route-contract-guard.mjs'
      console.log(JSON.stringify(inspectRouteContract('src/app/api/user/secure/route.ts', ${JSON.stringify(missingApiHandler)})))
    `)
    const missingAuthResult = runGuard<string[]>(`
      import { inspectRouteContract } from './scripts/guards/api-route-contract-guard.mjs'
      console.log(JSON.stringify(inspectRouteContract('src/app/api/user/secure/route.ts', ${JSON.stringify(missingAuth)})))
    `)

    expect(missingApiHandlerResult).toEqual([
      'src/app/api/user/secure/route.ts missing apiHandler wrapper',
    ])
    expect(missingAuthResult).toEqual([
      'src/app/api/user/secure/route.ts missing requireUserAuth/requireProjectAuth/requireProjectAuthLight',
    ])
  })
})
