import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { calcText } from '@/lib/billing/cost'
import { recordTextUsage } from '@/lib/billing/runtime-usage'
import { withTextBilling } from '@/lib/billing/service'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

describe('billing/api contract integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('returns 402 payload when balance is insufficient', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 0)

    const route = apiHandler(async () => {
      await withTextBilling(
        user.id,
        'anthropic/claude-sonnet-4',
        1000,
        { projectId: project.id, action: 'api_contract_insufficient' },
        async () => ({ ok: true }),
      )
      return NextResponse.json({ ok: true })
    })

    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: { 'x-request-id': 'req_insufficient' },
    })
    const response = await route(req, { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body?.error?.code).toBe('INSUFFICIENT_BALANCE')
    expect(typeof body?.required).toBe('number')
    expect(typeof body?.available).toBe('number')
  })

  it('rejects duplicate retry with same request id and prevents duplicate charge', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 5)

    const route = apiHandler(async () => {
      await withTextBilling(
        user.id,
        'anthropic/claude-sonnet-4',
        1000,
        { projectId: project.id, action: 'api_contract_dedupe' },
        async () => ({ ok: true }),
      )
      return NextResponse.json({ ok: true })
    })

    const req1 = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: { 'x-request-id': 'same_request_id' },
    })
    const req2 = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: { 'x-request-id': 'same_request_id' },
    })

    const resp1 = await route(req1, { params: Promise.resolve({}) })
    const resp2 = await route(req2, { params: Promise.resolve({}) })
    const body2 = await resp2.json()

    expect(resp1.status).toBe(200)
    expect(resp2.status).toBe(409)
    expect(body2?.error?.code).toBe('CONFLICT')
    expect(String(body2?.error?.message || '')).toContain('duplicate billing request already confirmed')

    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    const expectedCharge = calcText('anthropic/claude-sonnet-4', 1000, 0)
    expect(balance?.totalSpent).toBeCloseTo(expectedCharge, 8)
    expect(await prisma.balanceFreeze.count()).toBe(1)
  })

  it('settles cached OpenRouter text usage with provider reported cost credits', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const result = await withTextBilling(
      user.id,
      'openrouter::anthropic/claude-sonnet-4.6',
      5000,
      { projectId: project.id, action: 'api_contract_openrouter_cached' },
      async () => {
        recordTextUsage({
          model: 'openrouter::anthropic/claude-sonnet-4.6',
          inputTokens: 4000,
          outputTokens: 100,
          cachedInputTokens: 3200,
          cacheWriteTokens: 0,
          cacheHitRate: 0.8,
          providerCostCredits: 0.4321,
        })
        return { ok: true }
      },
    )

    expect(result).toEqual({ ok: true })
    const cost = await prisma.usageCost.findFirstOrThrow({
      where: {
        userId: user.id,
        projectId: project.id,
        action: 'api_contract_openrouter_cached',
      },
    })
    const metadata = JSON.parse(cost.metadata || '{}') as Record<string, unknown>
    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })

    expect(Number(cost.cost)).toBeCloseTo(0.4321, 8)
    expect(balance.totalSpent.toNumber()).toBeCloseTo(0.4321, 8)
    expect(metadata.actualInputTokens).toBe(4000)
    expect(metadata.actualOutputTokens).toBe(100)
    expect(metadata.actualCachedInputTokens).toBe(3200)
    expect(metadata.actualProviderCostCredits).toBeCloseTo(0.4321, 8)
  })
})
