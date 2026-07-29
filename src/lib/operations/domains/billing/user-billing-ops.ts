import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { toMoneyNumber } from '@/lib/billing/money'
import { getUserCostSummary } from '@/lib/billing'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { resolveBillingTransactionTargets } from './transaction-targets'
import {
  aggregateBillingTransactionRows,
  type BillingTransactionDisplayRow,
} from './transaction-aggregation'

const ACTION_KEY_PATTERN = /^[a-z][a-z0-9_-]*$/

const listUserTransactionsInputSchema = z.object({
  page: z.number().int().min(1).optional().describe('One-based page number. Defaults to 1.'),
  pageSize: z.number().int().min(1).max(200).optional().describe('Rows per page. Defaults to 20.'),
  type: z.string().trim().min(1).optional()
    .describe('Exact transaction type. Omit or use "all" to include every type.'),
  startDate: z.string().datetime({ offset: true }).optional()
    .describe('Inclusive ISO 8601 start timestamp with timezone.'),
  endDate: z.string().datetime({ offset: true }).optional()
    .describe('Inclusive ISO 8601 end timestamp with timezone.'),
}).strict()

function extractActionFromDescription(description: string | null): string | null {
  if (!description) return null
  const cleaned = description.replace(/^\[(?:SHADOW|FREEZE|REFUND)\]\s*/i, '').trim()
  const firstPart = cleaned.split(' - ')[0]?.trim() || ''
  if (ACTION_KEY_PATTERN.test(firstPart)) return firstPart
  return null
}

function readBillingMetaNumber(meta: Record<string, unknown> | null, key: string): number | null {
  const value = meta?.[key]
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * `freeze` / `refund` rows are amount = 0 ledger audit rows (like
 * `shadow_consume`): the ledger keeps SUM(amount) aligned with
 * balance + frozenAmount, while the moved amount lives in billingMeta.
 * For display, project the available-balance delta from billingMeta so the
 * row matches its balanceAfter movement.
 */
function resolveDisplayAmount(type: string, amount: number, billingMeta: Record<string, unknown> | null): number {
  if (type === 'freeze') {
    const freezeAmount = readBillingMetaNumber(billingMeta, 'freezeAmount')
    if (freezeAmount !== null) return -freezeAmount
  }
  if (type === 'refund') {
    const refundedAmount = readBillingMetaNumber(billingMeta, 'refundedAmount')
    if (refundedAmount !== null) return refundedAmount
  }
  return amount
}

export function createUserBillingOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_user_transactions: {
      id: 'list_user_transactions',
      summary: 'List balance transactions for the current user with filters and pagination.',
      intent: 'query',
      channels: { tool: false, api: true },
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: listUserTransactionsInputSchema,
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const params = listUserTransactionsInputSchema.parse(input)
        const page = params.page ?? 1
        const pageSize = params.pageSize ?? 20
        const type = params.type ?? null
        const startDate = params.startDate ? new Date(params.startDate) : null
        const endDate = params.endDate ? new Date(params.endDate) : null

        const where: Prisma.BalanceTransactionWhereInput = { userId: ctx.userId }
        if (type && type !== 'all') {
          where.type = type
        }

        if (startDate || endDate) {
          where.createdAt = {}
          if (startDate) {
            where.createdAt.gte = startDate
          }
          if (endDate) {
            const endDateTime = new Date(endDate)
            endDateTime.setHours(23, 59, 59, 999)
            where.createdAt.lte = endDateTime
          }
        }

        const [transactionsRaw, total] = await Promise.all([
          prisma.balanceTransaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.balanceTransaction.count({ where }),
        ])

        const freezeIds = [...new Set(transactionsRaw.map((t) => t.freezeId).filter(Boolean) as string[])]
        const freezes = freezeIds.length > 0
          ? await prisma.balanceFreeze.findMany({
            where: { id: { in: freezeIds }, userId: ctx.userId },
            select: { id: true, taskId: true },
          })
          : []
        const taskIds = [...new Set(freezes.map((freeze) => freeze.taskId).filter(Boolean) as string[])]
        const tasks = taskIds.length > 0
          ? await prisma.task.findMany({
            where: { id: { in: taskIds }, userId: ctx.userId },
            select: {
              id: true,
              projectId: true,
              episodeId: true,
              type: true,
              targetType: true,
              targetId: true,
              operationId: true,
              operationRequestId: true,
            },
          })
          : []
        const taskById = new Map(tasks.map((task) => [task.id, task]))
        const taskByFreezeId = new Map(
          freezes
            .map((freeze) => {
              const task = freeze.taskId ? taskById.get(freeze.taskId) : null
              return task ? [freeze.id, task] as const : null
            })
            .filter((item): item is readonly [string, NonNullable<(typeof tasks)[number]>] => item !== null),
        )

        const targetByTaskId = await resolveBillingTransactionTargets(tasks)
        const projectIds = [
          ...new Set(transactionsRaw
            .map((t) => t.projectId ?? (t.freezeId ? taskByFreezeId.get(t.freezeId)?.projectId ?? null : null))
            .filter(Boolean) as string[]),
        ]
        const episodeIds = [
          ...new Set(transactionsRaw
            .map((t) => t.episodeId ?? (t.freezeId ? taskByFreezeId.get(t.freezeId)?.episodeId ?? null : null))
            .filter(Boolean) as string[]),
        ]

        const [projects, episodes] = await Promise.all([
          projectIds.length > 0
            ? prisma.project.findMany({
              where: { id: { in: projectIds } },
              select: { id: true, name: true },
            })
            : Promise.resolve([]),
          episodeIds.length > 0
            ? prisma.projectEpisode.findMany({
              where: { id: { in: episodeIds } },
              select: { id: true, episodeNumber: true, name: true },
            })
            : Promise.resolve([]),
        ])

        const projectMap = new Map(projects.map((p) => [p.id, p.name]))
        const episodeMap = new Map(episodes.map((e) => [e.id, { episodeNumber: e.episodeNumber, name: e.name }]))

        const transactions = transactionsRaw.map((item): BillingTransactionDisplayRow => {
          let billingMeta: Record<string, unknown> | null = null
          if (item.billingMeta && typeof item.billingMeta === 'string') {
            try {
              billingMeta = JSON.parse(item.billingMeta) as Record<string, unknown>
            } catch {
              billingMeta = null
            }
          }

          const task = item.freezeId ? taskByFreezeId.get(item.freezeId) ?? null : null
          const projectId = item.projectId ?? task?.projectId ?? null
          const episodeId = item.episodeId ?? task?.episodeId ?? null
          const action = item.taskType ?? task?.type ?? extractActionFromDescription(item.description)

          return {
            ...item,
            amount: resolveDisplayAmount(item.type, toMoneyNumber(item.amount), billingMeta),
            balanceAfter: toMoneyNumber(item.balanceAfter),
            action,
            projectId,
            episodeId,
            projectName: projectId ? (projectMap.get(projectId) ?? null) : null,
            episodeNumber: episodeId ? (episodeMap.get(episodeId)?.episodeNumber ?? null) : null,
            episodeName: episodeId ? (episodeMap.get(episodeId)?.name ?? null) : null,
            billingMeta,
            target: task ? (targetByTaskId.get(task.id) ?? null) : null,
            operationId: task?.operationId ?? null,
            operationRequestId: task?.operationRequestId ?? null,
          }
        })

        return {
          currency: BILLING_CURRENCY,
          transactions: aggregateBillingTransactionRows(transactions),
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        }
      },
    },

    get_user_costs: {
      id: 'get_user_costs',
      summary: 'Get current user cost summary by project.',
      intent: 'query',
      channels: { tool: false, api: true },
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        const costSummary = await getUserCostSummary(ctx.userId)

        const projectIds = costSummary.byProject.map((p) => p.projectId)
        const projects = projectIds.length > 0
          ? await prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, name: true },
          })
          : []

        const projectMap = new Map(projects.map((p) => [p.id, p.name]))

        const byProjectWithNames = costSummary.byProject.map((p) => ({
          projectId: p.projectId,
          projectName: projectMap.get(p.projectId) || '未知项目',
          totalCost: p._sum.cost || 0,
          recordCount: p._count,
        }))

        return {
          userId: ctx.userId,
          currency: BILLING_CURRENCY,
          total: costSummary.total,
          byProject: byProjectWithNames.sort((a, b) => b.totalCost - a.totalCost),
        }
      },
    },
  }
}
