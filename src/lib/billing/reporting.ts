import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ApiType, UsageUnit } from './cost'
import { BillingOperationError } from './errors'
import { toMoneyNumber } from './money'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import { resolvePublicModelName } from '@/lib/ai-exec/model-presentation'

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
  chargedCredits?: number
  balanceAfter: number
  freezeId?: string
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
  const meta: Record<string, unknown> = {
    quantity: params.quantity,
    unit: params.unit,
    model: resolvePublicModelName(params.model),
    apiType: params.apiType,
  }

  // 从 pricingSelections 提取 capability 字段（图片分辨率、视频时长/分辨率等）
  const selections = params.metadata?.pricingSelections
  const selectionRecord =
    selections && typeof selections === 'object' && !Array.isArray(selections)
      ? (selections as Record<string, unknown>)
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
  const cachedInputTokens =
    params.metadata?.actualCachedInputTokens ?? params.metadata?.cachedInputTokens
  if (inputTokens) meta.inputTokens = inputTokens
  if (outputTokens) meta.outputTokens = outputTokens
  if (cachedInputTokens) meta.cachedInputTokens = cachedInputTokens

  const chargedCost = params.metadata?.chargedCost
  if (typeof chargedCost === 'number' && Number.isFinite(chargedCost)) {
    meta.chargedCost = chargedCost
  }

  // 实际使用的模型列表（复合模型场景）
  if (
    Array.isArray(params.metadata?.actualModels) &&
    (params.metadata.actualModels as unknown[]).length > 0
  ) {
    const actualModels = (params.metadata.actualModels as unknown[])
      .map((value) => typeof value === 'string' ? resolvePublicModelName(value) : null)
      .filter((value): value is string => Boolean(value))
    if (actualModels.length > 0) meta.actualModels = actualModels
  }

  return meta
}

const PUBLIC_BILLING_META_KEYS = [
  'quantity',
  'unit',
  'apiType',
  'resolution',
  'duration',
  'generateAudio',
  'generationMode',
  'quality',
  'size',
  'aspectRatio',
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'chargedCost',
  'freezeAmount',
  'refundedAmount',
  'receiptUrl',
] as const

/** Final public billing projection; internal model and pricing identities stay private. */
export function projectPublicBillingMeta(
  meta: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!meta) return null

  const projected: Record<string, unknown> = {}
  for (const key of PUBLIC_BILLING_META_KEYS) {
    const value = meta[key]
    if (value !== undefined && value !== null) projected[key] = value
  }

  return Object.keys(projected).length > 0 ? projected : null
}

export function buildBillingMeta(params: Parameters<typeof buildBillingMetaRecord>[0]): string {
  return JSON.stringify(buildBillingMetaRecord(params))
}

/**
 * 用量事实 writer（唯一的 UsageCost 写入点）。
 * 这里只写用量事实，不直接创建 BalanceTransaction；需要资金事件的调用方
 * 必须在同一事务内先经账本唯一入口扣减，再把实际扣减额一并写入事实。
 */
export async function recordUsageFact(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  params: Pick<
    PureRecordParams,
    | 'projectId'
    | 'userId'
    | 'action'
    | 'apiType'
    | 'model'
    | 'quantity'
    | 'unit'
    | 'cost'
    | 'chargedCredits'
    | 'metadata'
  > & {
    usageId?: string
  },
): Promise<boolean> {
  if (!isProjectScoped(params.projectId)) {
    return false
  }
  const project = await txOrPrisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true },
  })
  if (!project) {
    throw new BillingOperationError(
      'BILLING_INVALID_PROJECT',
      `project not found for billing: ${params.projectId}`,
      {
        projectId: params.projectId,
        action: params.action,
        apiType: params.apiType,
      },
    )
  }

  const usageId = params.usageId?.trim() || null
  if (usageId && usageId.length > 191) {
    throw new BillingOperationError('BILLING_INVALID_USAGE_IDENTITY', 'usage identity is invalid', {
      usageId,
    })
  }
  const metadata = params.metadata ? JSON.stringify(params.metadata) : null
  const data = {
    ...(usageId ? { id: usageId } : {}),
    projectId: params.projectId,
    userId: params.userId,
    apiType: params.apiType,
    model: params.model,
    action: params.action,
    quantity: params.quantity,
    unit: params.unit,
    cost: params.cost,
    chargedCredits: params.chargedCredits ?? 0,
    metadata,
  }
  try {
    await txOrPrisma.usageCost.create({ data })
  } catch (error) {
    if (
      !usageId ||
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      throw error
    }
    const existing = await txOrPrisma.usageCost.findUnique({
      where: { id: usageId },
    })
    if (
      !existing ||
      existing.projectId !== data.projectId ||
      existing.userId !== data.userId ||
      existing.apiType !== data.apiType ||
      existing.model !== data.model ||
      existing.action !== data.action ||
      existing.quantity !== data.quantity ||
      existing.unit !== data.unit ||
      toMoneyNumber(existing.cost) !== toMoneyNumber(data.cost) ||
      existing.chargedCredits !== data.chargedCredits ||
      existing.metadata !== data.metadata
    ) {
      throw new BillingOperationError(
        'BILLING_USAGE_REPLAY_DIVERGED',
        'usage fact replay diverged from the persisted identity',
        { usageId },
        error,
      )
    }
  }
  return true
}

export async function recordUsageCostOnly(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  params: PureRecordParams,
): Promise<void> {
  const hasProject = await recordUsageFact(txOrPrisma, {
    ...params,
    chargedCredits: params.cost,
  })
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
      taskType: params.taskType || params.action || null,
      billingMeta: buildBillingMeta(params),
    },
  })

  _ulogInfo(
    `[Billing] ${params.action} - ${params.model} - ${params.cost} credits (recorded${hasProject ? '' : ', no project scope'})`,
  )
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
    id: item.id,
    projectId: item.projectId,
    apiType: item.apiType,
    action: item.action,
    quantity: item.quantity,
    unit: item.unit,
    cost: toMoneyNumber(item.cost),
    chargedCredits: item.chargedCredits,
    createdAt: item.createdAt,
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

export async function getUserCostDetails(
  userId: string,
  page = 1,
  pageSize = 20,
  projectId?: string,
) {
  const skip = (page - 1) * pageSize
  const where = { userId, ...(projectId ? { projectId } : {}) }

  const [recordsRaw, total] = await Promise.all([
    prisma.usageCost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.usageCost.count({ where }),
  ])

  const records = recordsRaw.map((item) => ({
    id: item.id,
    projectId: item.projectId,
    apiType: item.apiType,
    action: item.action,
    quantity: item.quantity,
    unit: item.unit,
    cost: toMoneyNumber(item.cost),
    chargedCredits: item.chargedCredits,
    createdAt: item.createdAt,
  }))

  return {
    records,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}
