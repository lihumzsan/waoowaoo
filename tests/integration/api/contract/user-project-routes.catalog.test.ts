import { describe, expect, it } from 'vitest'
import { ROUTE_CATALOG } from '../../../contracts/route-catalog'

describe('api contract - user/project route catalog', () => {
  it('keeps user api-config route registered for contract coverage', () => {
    expect(ROUTE_CATALOG.map((e) => e.routeFile)).toContain('src/app/api/user/api-config/route.ts')
  })
})
