import { expect } from 'vitest'
import { prisma } from './prisma'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    return value.toNumber()
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function expectBalance(userId: string, params: {
  balance: number
  frozenAmount: number
  totalSpent: number
}) {
  const row = await prisma.userBalance.findUnique({ where: { userId } })
  expect(row).toBeTruthy()
  expect(toNumber(row!.balance)).toBeCloseTo(params.balance, 8)
  expect(toNumber(row!.frozenAmount)).toBeCloseTo(params.frozenAmount, 8)
  expect(toNumber(row!.totalSpent)).toBeCloseTo(params.totalSpent, 8)
}

export async function expectNoNegativeLedger(userId: string) {
  const row = await prisma.userBalance.findUnique({ where: { userId } })
  expect(row).toBeTruthy()
  expect(toNumber(row!.balance)).toBeGreaterThanOrEqual(0)
  expect(toNumber(row!.frozenAmount)).toBeGreaterThanOrEqual(0)
  expect(toNumber(row!.totalSpent)).toBeGreaterThanOrEqual(0)
}
