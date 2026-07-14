import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import {
  aggregateBillingTransactionRows,
  type BillingTransactionDisplayRow,
} from '@/lib/operations/domains/billing/transaction-aggregation'

function createDisplayRow(
  index: number,
  overrides: Partial<BillingTransactionDisplayRow> = {},
): BillingTransactionDisplayRow {
  return {
    id: `transaction_${index}`,
    userId: 'user_transaction_aggregation',
    type: 'consume',
    amount: -1.14,
    balanceAfter: 10 - index * 1.14,
    description: 'image_character - gpt-image-2',
    relatedId: `freeze_${index}`,
    freezeId: `freeze_${index}`,
    operatorId: null,
    externalOrderId: null,
    idempotencyKey: `aggregation_${index}`,
    projectId: 'project_aggregation',
    episodeId: 'episode_aggregation',
    taskType: TASK_TYPE.IMAGE_CHARACTER,
    billingMeta: {
      quantity: 1,
      unit: 'image',
      model: 'gpt-image-2',
      apiType: 'image',
      resolution: '1K',
      chargedCost: 1.14,
    },
    createdAt: new Date(`2026-07-01T12:00:0${index}.000Z`),
    action: TASK_TYPE.IMAGE_CHARACTER,
    projectName: 'Aggregation Project',
    episodeNumber: 1,
    episodeName: 'Pilot',
    target: {
      targetType: 'CharacterAppearance',
      targetId: `appearance_${index}`,
      labelKey: 'transactionTargets.characterAppearance',
      labelParams: { name: 'Character', index },
    },
    operationId: 'generate_character_images',
    operationRequestId: 'request_generate_character_images',
    ...overrides,
  }
}

describe('billing transaction display aggregation', () => {
  it('groups one submitted image batch into one display row with summed charge and quantity', () => {
    const result = aggregateBillingTransactionRows([
      createDisplayRow(3, { balanceAfter: 6.58 }),
      createDisplayRow(2, { balanceAfter: 7.72 }),
      createDisplayRow(1, { balanceAfter: 8.86 }),
    ])

    expect(result).toHaveLength(1)
    const group = result[0]
    expect(group.id).toBe('group:request_generate_character_images:generate_character_images:transaction_3')
    expect(group.amount).toBeCloseTo(-3.42, 8)
    expect(group.balanceAfter).toBeCloseTo(6.58, 8)
    expect(group.transactionCount).toBe(3)
    expect(group.billingMeta).toMatchObject({
      quantity: 3,
      chargedCost: 3.42,
      unit: 'image',
      model: 'gpt-image-2',
      resolution: '1K',
    })
    expect(group.target).toMatchObject({
      targetType: 'CharacterAppearance',
      targetId: 'group:CharacterAppearance',
      labelKey: 'transactionTargets.characterAppearanceGroup',
      labelParams: { count: 3 },
    })
  })

  it('keeps rows separate without a complete operation identity', () => {
    const result = aggregateBillingTransactionRows([
      createDisplayRow(1, { operationRequestId: null }),
      createDisplayRow(2, { operationRequestId: null }),
    ])

    expect(result).toHaveLength(2)
    expect(result.map((row) => row.id)).toEqual(['transaction_1', 'transaction_2'])
  })

  it('keeps rows separate when the pricing specification differs', () => {
    const result = aggregateBillingTransactionRows([
      createDisplayRow(1),
      createDisplayRow(2, {
        billingMeta: {
          quantity: 1,
          unit: 'image',
          model: 'gpt-image-2',
          apiType: 'image',
          resolution: '2K',
          chargedCost: 2.28,
        },
      }),
    ])

    expect(result).toHaveLength(2)
    expect(result.map((row) => row.id)).toEqual(['transaction_1', 'transaction_2'])
  })
})
