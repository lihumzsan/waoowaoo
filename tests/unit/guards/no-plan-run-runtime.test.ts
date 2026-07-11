import { describe, expect, it } from 'vitest'
import { inspectRetiredPlanRunContent } from '../../../scripts/guards/no-plan-run-runtime.mjs'

describe('no PlanRun runtime guard', () => {
  it('rejects a restored runtime operation marker', () => {
    expect(inspectRetiredPlanRunContent(
      'src/lib/operations/example.ts',
      "const operationId = 'create_plan_run'",
    )).toEqual([
      'src/lib/operations/example.ts contains retired PlanRun marker "create_plan_run"',
    ])
  })

  it('rejects a Prisma model that restores a writable PlanRun delegate', () => {
    expect(inspectRetiredPlanRunContent(
      'prisma/schema.prisma',
      'model PlanRun { id String @id }',
    )).toEqual([
      'prisma/schema.prisma contains retired PlanRun marker "model PlanRun"',
    ])
  })
})
