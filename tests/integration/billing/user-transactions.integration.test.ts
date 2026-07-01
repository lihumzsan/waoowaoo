import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { TASK_TYPE } from '@/lib/task/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { createUserBillingOperations } from '@/lib/operations/domains/billing/user-billing-ops'
import { confirmChargeWithRecord, freezeBalance } from '@/lib/billing/ledger'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createQueuedTask, createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EXPECTED_RECORD')
  }
  return value as Record<string, unknown>
}

function readArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('EXPECTED_ARRAY')
  return value
}

function createOperationContext(userId: string): ProjectAgentOperationContext {
  return {
    request: new NextRequest('http://localhost/api/user/transactions'),
    userId,
    projectId: 'system',
    context: {},
    source: 'user',
    writer: null,
    toolCallId: null,
  } as unknown as ProjectAgentOperationContext
}

describe('billing/user transactions integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('returns project, episode, task target and billing detail for image consumption', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const episode = await prisma.projectEpisode.create({
      data: {
        projectId: project.id,
        episodeNumber: 3,
        name: '第三集',
      },
    })
    const storyboard = await prisma.projectStoryboard.create({
      data: {
        episodeId: episode.id,
      },
    })
    const panel = await prisma.projectPanel.create({
      data: {
        storyboardId: storyboard.id,
        panelIndex: 4,
        panelNumber: 12,
      },
    })
    const task = await createQueuedTask({
      id: 'task_user_transactions_panel_image',
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: panel.id,
    })

    const freezeId = await freezeBalance(user.id, 1.25, {
      source: 'task',
      taskId: task.id,
      idempotencyKey: 'user_transactions_panel_image',
    })
    expect(freezeId).toBeTruthy()

    await confirmChargeWithRecord(
      freezeId!,
      {
        projectId: project.id,
        episodeId: episode.id,
        taskType: TASK_TYPE.IMAGE_PANEL,
        action: TASK_TYPE.IMAGE_PANEL,
        apiType: 'image',
        model: 'ark::doubao-seedream-4-5-251128',
        quantity: 1,
        unit: 'image',
        metadata: {
          pricingSelections: {
            resolution: '1080p',
            aspectRatio: '9:16',
          },
          chargedCost: 1.25,
        },
      },
      { chargedAmount: 1.25 },
    )

    const operation = createUserBillingOperations().list_user_transactions
    const result = await operation.execute(createOperationContext(user.id), { pageSize: 20 })
    const payload = readRecord(result)
    const transactions = readArray(payload.transactions)
    expect(transactions).toHaveLength(1)

    const transaction = readRecord(transactions[0])
    expect(transaction.type).toBe('consume')
    expect(transaction.amount).toBeCloseTo(-1.25, 8)
    expect(transaction.action).toBe(TASK_TYPE.IMAGE_PANEL)
    expect(transaction.projectId).toBe(project.id)
    expect(transaction.projectName).toBe(project.name)
    expect(transaction.episodeId).toBe(episode.id)
    expect(transaction.episodeNumber).toBe(3)
    expect(transaction.episodeName).toBe('第三集')

    const billingMeta = readRecord(transaction.billingMeta)
    expect(billingMeta).toMatchObject({
      quantity: 1,
      unit: 'image',
      model: 'doubao-seedream-4-5-251128',
      apiType: 'image',
      resolution: '1080p',
      aspectRatio: '9:16',
      chargedCost: 1.25,
    })

    const target = readRecord(transaction.target)
    expect(target).toMatchObject({
      targetType: 'ProjectPanel',
      targetId: panel.id,
      labelKey: 'transactionTargets.projectPanel',
      labelParams: { number: 12 },
    })
  })

  it('aggregates one submitted image batch into one displayed transaction', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const episode = await prisma.projectEpisode.create({
      data: {
        projectId: project.id,
        episodeNumber: 5,
        name: '批量生图集',
      },
    })
    const storyboard = await prisma.projectStoryboard.create({
      data: {
        episodeId: episode.id,
      },
    })

    for (let index = 0; index < 3; index += 1) {
      const panelNumber = index + 1
      const panel = await prisma.projectPanel.create({
        data: {
          storyboardId: storyboard.id,
          panelIndex: index,
          panelNumber,
        },
      })
      const task = await createQueuedTask({
        id: `task_user_transactions_batch_image_${panelNumber}`,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: panel.id,
        operationId: 'generate_panel_images',
        operationRequestId: 'request_user_transactions_batch_image',
      })

      const freezeId = await freezeBalance(user.id, 1.14, {
        source: 'task',
        taskId: task.id,
        idempotencyKey: `user_transactions_batch_image_${panelNumber}`,
      })
      if (!freezeId) throw new Error('failed to create batch image freeze')

      await confirmChargeWithRecord(
        freezeId,
        {
          projectId: project.id,
          episodeId: episode.id,
          taskType: TASK_TYPE.IMAGE_PANEL,
          action: TASK_TYPE.IMAGE_PANEL,
          apiType: 'image',
          model: 'openai::gpt-image-2',
          quantity: 1,
          unit: 'image',
          metadata: {
            pricingSelections: {
              resolution: '1K',
            },
            chargedCost: 1.14,
          },
        },
        { chargedAmount: 1.14 },
      )
    }

    const operation = createUserBillingOperations().list_user_transactions
    const result = await operation.execute(createOperationContext(user.id), { pageSize: 20 })
    const payload = readRecord(result)
    const transactions = readArray(payload.transactions)
    expect(transactions).toHaveLength(1)

    const pagination = readRecord(payload.pagination)
    expect(pagination.total).toBe(3)

    const transaction = readRecord(transactions[0])
    expect(transaction.type).toBe('consume')
    expect(transaction.amount).toBeCloseTo(-3.42, 8)
    expect(transaction.balanceAfter).toBeCloseTo(6.58, 8)
    expect(transaction.action).toBe(TASK_TYPE.IMAGE_PANEL)
    expect(transaction.projectId).toBe(project.id)
    expect(transaction.projectName).toBe(project.name)
    expect(transaction.episodeId).toBe(episode.id)
    expect(transaction.episodeNumber).toBe(5)
    expect(transaction.episodeName).toBe('批量生图集')
    expect(transaction.transactionCount).toBe(3)

    const billingMeta = readRecord(transaction.billingMeta)
    expect(billingMeta).toMatchObject({
      quantity: 3,
      unit: 'image',
      model: 'gpt-image-2',
      apiType: 'image',
      resolution: '1K',
      chargedCost: 3.42,
    })

    const target = readRecord(transaction.target)
    expect(target).toMatchObject({
      targetType: 'ProjectPanel',
      targetId: 'group:ProjectPanel',
      labelKey: 'transactionTargets.projectPanelGroup',
      labelParams: { count: 3 },
    })
  })

  it('extracts hyphenated sync billing action from historical transaction description', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    await prisma.balanceTransaction.create({
      data: {
        userId: user.id,
        type: 'consume',
        amount: -1.14,
        balanceAfter: 8.86,
        description: 'shot-execution-plan - google/gemini-3.5-flash',
        projectId: project.id,
        billingMeta: JSON.stringify({
          quantity: 27003,
          unit: 'token',
          model: 'google/gemini-3.5-flash',
        }),
      },
    })

    const operation = createUserBillingOperations().list_user_transactions
    const result = await operation.execute(createOperationContext(user.id), { pageSize: 20 })
    const payload = readRecord(result)
    const transactions = readArray(payload.transactions)
    expect(transactions).toHaveLength(1)

    const transaction = readRecord(transactions[0])
    expect(transaction.action).toBe('shot-execution-plan')
    expect(transaction.projectName).toBe(project.name)

    const billingMeta = readRecord(transaction.billingMeta)
    expect(billingMeta).toMatchObject({
      quantity: 27003,
      unit: 'token',
      model: 'google/gemini-3.5-flash',
    })
  })
})
