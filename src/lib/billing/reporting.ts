import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ApiType, UsageUnit } from './cost'
import { BillingOperationError } from './errors'
import { toMoneyNumber } from './money'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'

interface RecordParams {
  projectId: string
  userId: string
  action: string
  metadata?: Record<string, unknown>
}

interface PureRecordParams extends RecordParams {
  apiType: ApiType
  model: string
  quantity: number
  unit: UsageUnit
  cost: number
  balanceAfter: number
  freezeId?: string
  episodeId?: string | null
  taskType?: string | null
}

const VIRTUAL_PROJECT_IDS = new Set(['asset-hub', GLOBAL_ASSET_PROJECT_ID, 'system'])

export function isProjectScoped(projectId: string): boolean {
  return Boolean(projectId && !VIRTUAL_PROJECT_IDS.has(projectId))
}

/**
 * 从计费参数中提取展示用的详细信息，序列化为 JSON 存入 billingMeta
 * 前端按 unit 字段决定展示方式：
 *   image  → "3张 · 2K"
 *   video  → "5秒 · 720p"
 *   token  → "1500 tokens"
 *   second → "30秒"
 *   call   → "1次"
 */
export function buildBillingMetaRecord(params: {
  quantity: number
  unit: string
  model: string
  apiType: string
  metadata?: Record<string, unknown>
}): Record<string, unknown> {
  // 尝试从 model composite ID 提取短名 "provider:xxx::model" → "model"
  const modelShort = params.model.includes('::')
    ? params.model.split('::').pop() ?? params.model
    : params.model

  const meta: Record<string, unknown> = {
    quantity: params.quantity,
    unit: params.unit,
    model: modelShort,
    apiType: params.apiType,
  }

  // 从 pricingSelections 提取 capability 字段（图片分辨率、视频时长/分辨率等）
  const selections = params.metadata?.pricingSelections
  const selectionRecord = selections && typeof selections === 'object' && !Array.isArray(selections)
    ? selections as Record<string, unknown>
    : {}
  const detailSource = {
    ...selectionRecord,
    ...(params.metadata || {}),
  }
  if (detailSource.resolution) meta.resolution = detailSource.resolution
  if (detailSource.duration) meta.duration = detailSource.duration
  if (detailSource.actualDurationSeconds) meta.duration = detailSource.actualDurationSeconds
  if (detailSource.generateAudio !== undefined) meta.generateAudio = detailSource.generateAudio
  if (detailSource.generationMode) meta.generationMode = detailSource.generationMode
  if (detailSource.quality) meta.quality = detailSource.quality
  if (detailSource.size) meta.size = detailSource.size
  if (detailSource.aspectRatio) meta.aspectRatio = detailSource.aspectRatio

  const inputTokens = params.metadata?.actualInputTokens ?? params.metadata?.inputTokens
  const outputTokens = params.metadata?.actualOutputTokens ?? params.metadata?.outputTokens
  const cachedInputTokens = params.metadata?.actualCachedInputTokens ?? params.metadata?.cachedInputTokens
  if (inputTokens) meta.inputTokens = inputTokens
  if (outputTokens) meta.outputTokens = outputTokens
  if (cachedInputTokens) meta.cachedInputTokens = cachedInputTokens

  const chargedCost = params.metadata?.chargedCost
  if (typeof chargedCost === 'number' && Number.isFinite(chargedCost)) {
    meta.chargedCost = chargedCost
  }

  // 实际使用的模型列表（复合模型场景）
  if (Array.isArray(params.metadata?.actualModels) && (params.metadata.actualModels as unknown[]).length > 0) {
    meta.actualModels = params.metadata.actualModels
  }

  return meta
}

export function buildBillingMeta(params: Parameters<typeof buildBillingMetaRecord>[0]): string {
  return JSON.stringify(buildBillingMetaRecord(params))
}

/**
 * 用量事实 writer（唯一的 UsageCost 写入点）。
 * 只记录用量，不产生任何 BalanceTransaction：没有资金事件的消耗
 * （如当前免费的 assistant run）走这里，资金流水只属于账本生命周期。
 */
export async function recordUsageFact(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  params: Pick<PureRecordParams, 'projectId' | 'userId' | 'action' | 'apiType' | 'model' | 'quantity' | 'unit' | 'cost' | 'metadata'>,
): Promise<boolean> {
  if (!isProjectScoped(params.projectId)) {
    return false
  }
  const project = await txOrPrisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true },
  })
  if (!project) {
    throw new BillingOperationError('BILLING_INVALID_PROJECT', `project not found for billing: ${params.projectId}`, {
      projectId: params.projectId,
      action: params.action,
      apiType: params.apiType,
    })
  }

  await txOrPrisma.usageCost.create({
    data: {
      projectId: params.projectId,
      userId: params.userId,
      apiType: params.apiType,
      model: params.model,
      action: params.action,
      quantity: params.quantity,
      unit: params.unit,
      cost: params.cost,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
  return true
}

export async function recordUsageCostOnly(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  params: PureRecordParams,
): Promise<void> {
  const hasProject = await recordUsageFact(txOrPrisma, params)
  if (!hasProject) {
    _ulogInfo(`[计费] 跳过 UsageCost 记录 (projectId=${params.projectId})，仅记录流水`)
  }

  await txOrPrisma.balanceTransaction.create({
    data: {
      userId: params.userId,
      type: 'consume',
      amount: -params.cost,
      balanceAfter: params.balanceAfter,
      description: `${params.action} - ${params.model}${hasProject ? '' : ' (Asset Hub)'}`,
      relatedId: params.freezeId || null,
      freezeId: params.freezeId || null,
      projectId: hasProject ? params.projectId : null,
      episodeId: params.episodeId || null,
      taskType: params.taskType || params.action || null,
      billingMeta: buildBillingMeta(params),
    },
  })

  _ulogInfo(`[Billing] ${params.action} - ${params.model} - ${params.cost.toFixed(4)} credits (recorded${hasProject ? '' : ', no project scope'})`)
}

export async function getProjectTotalCost(projectId: string): Promise<number> {
  try {
    const result = await prisma.usageCost.aggregate({
      where: { projectId },
      _sum: { cost: true },
    })
    return toMoneyNumber(result._sum.cost)
  } catch (error) {
    _ulogError('[Billing] project total cost query failed', { projectId }, error)
    throw error
  }
}

export async function getProjectCostDetails(projectId: string) {
  const byTypeRaw = await prisma.usageCost.groupBy({
    by: ['apiType'],
    where: { projectId },
    _sum: { cost: true },
    _count: true,
  })

  const byActionRaw = await prisma.usageCost.groupBy({
    by: ['action'],
    where: { projectId },
    _sum: { cost: true },
    _count: true,
  })

  const recentRecordsRaw = await prisma.usageCost.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  const byType = byTypeRaw.map((item) => ({
    ...item,
    _sum: {
      ...item._sum,
      cost: toMoneyNumber(item._sum.cost),
    },
  }))
  const byAction = byActionRaw.map((item) => ({
    ...item,
    _sum: {
      ...item._sum,
      cost: toMoneyNumber(item._sum.cost),
    },
  }))
  const recentRecords = recentRecordsRaw.map((item) => ({
    ...item,
    cost: toMoneyNumber(item.cost),
  }))

  return {
    total: await getProjectTotalCost(projectId),
    byType,
    byAction,
    recentRecords,
  }
}

export async function getUserCostSummary(userId: string) {
  try {
    const byProjectRaw = await prisma.usageCost.groupBy({
      by: ['projectId'],
      where: { userId },
      _sum: { cost: true },
      _count: true,
    })

    const totalResult = await prisma.usageCost.aggregate({
      where: { userId },
      _sum: { cost: true },
    })

    return {
      total: toMoneyNumber(totalResult._sum.cost),
      byProject: byProjectRaw.map((item) => ({
        ...item,
        _sum: {
          ...item._sum,
          cost: toMoneyNumber(item._sum.cost),
        },
      })),
    }
  } catch (error) {
    _ulogError('[Billing] user cost summary query failed', { userId }, error)
    throw error
  }
}

export async function getUserCostDetails(userId: string, page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize

  const [recordsRaw, total] = await Promise.all([
    prisma.usageCost.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.usageCost.count({ where: { userId } }),
  ])

  const records = recordsRaw.map((item) => ({
    ...item,
    cost: toMoneyNumber(item.cost),
  }))

  return {
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}
