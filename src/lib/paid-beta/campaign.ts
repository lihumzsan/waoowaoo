import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const PAID_BETA_CAMPAIGN_ID = 'paid-beta-wave-1'
export const PAID_BETA_ATTEMPT_METADATA_KEY = 'paid_beta_attempt_id'
export const PAID_BETA_SEAT_METADATA_KEY = 'paid_beta_seat_id'

export type PaidBetaProviderKind = 'stripe_checkout' | 'stripe_wechat' | 'stripe_alipay'

export interface PaidBetaCampaignView {
  readonly id: string
  readonly status: 'active' | 'ended'
  readonly capacity: number
  readonly occupied: number
  readonly paidMembers: number
  readonly remaining: number
  readonly soldOut: boolean
  readonly paymentOpen: boolean
}

export interface PaidBetaPaymentAttemptClaim {
  readonly attemptId: string
  readonly seatId: string
  readonly campaignId: string
  readonly expiresAt: Date
}

export class PaidBetaPaymentUnavailableError extends Error {
  readonly code = 'PAID_BETA_SOLD_OUT'

  constructor() {
    super('PAID_BETA_SOLD_OUT')
    this.name = 'PaidBetaPaymentUnavailableError'
  }
}

export function isPaidBetaPaymentUnavailableError(
  error: unknown,
): error is PaidBetaPaymentUnavailableError {
  return error instanceof PaidBetaPaymentUnavailableError
}

function campaignIsActive(
  campaign: { status: string; startsAt: Date; endsAt: Date | null },
  now: Date,
): boolean {
  return campaign.status === 'active'
    && campaign.startsAt.getTime() <= now.getTime()
    && (campaign.endsAt === null || campaign.endsAt.getTime() > now.getTime())
}

async function countCampaignSeats(
  client: Pick<PrismaClient, 'paidBetaSeat'>,
  campaignId: string,
): Promise<{ occupied: number; paidMembers: number }> {
  const [occupied, paidMembers] = await Promise.all([
    client.paidBetaSeat.count({
      where: { campaignId, status: { in: ['reserved', 'paid'] } },
    }),
    client.paidBetaSeat.count({ where: { campaignId, status: 'paid' } }),
  ])
  return { occupied, paidMembers }
}

export async function readPaidBetaCampaignView(
  now: Date = new Date(),
): Promise<PaidBetaCampaignView> {
  const campaign = await prisma.paidBetaCampaign.findUnique({
    where: { id: PAID_BETA_CAMPAIGN_ID },
  })
  if (!campaign) {
    throw new Error(`PAID_BETA_CAMPAIGN_MISSING: ${PAID_BETA_CAMPAIGN_ID}`)
  }
  const counts = await countCampaignSeats(prisma, campaign.id)
  const remaining = Math.max(0, campaign.capacity - counts.occupied)
  const active = campaignIsActive(campaign, now)
  return {
    id: campaign.id,
    status: active ? 'active' : 'ended',
    capacity: campaign.capacity,
    occupied: counts.occupied,
    paidMembers: counts.paidMembers,
    remaining,
    soldOut: remaining === 0,
    paymentOpen: active && remaining > 0,
  }
}

const PROVIDER_ATTEMPT_TTL_MS: Record<PaidBetaProviderKind, number> = {
  // Stripe requires Checkout expiry to be at least 30 minutes after the API
  // receives the request. The extra minute absorbs request and clock skew.
  stripe_checkout: 31 * 60 * 1000,
  stripe_wechat: 10 * 60 * 1000,
  stripe_alipay: 10 * 60 * 1000,
}

function isPaidBetaProviderKind(value: string): value is PaidBetaProviderKind {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ATTEMPT_TTL_MS, value)
}

/**
 * Reserve one participant identity before creating a provider object.
 *
 * Updating the campaign row first serializes every allocation on the one
 * capacity owner. Repeat attempts by a currently reserved user reuse their
 * seat; repeat purchases by a paid user are allowed only while the wave still
 * has room, matching the product rule that all payment entry points close at
 * 100 occupied seats.
 */
export async function beginPaidBetaPaymentAttempt(
  input: {
    readonly userId: string
    readonly providerKind: PaidBetaProviderKind
    readonly now?: Date
  },
): Promise<PaidBetaPaymentAttemptClaim> {
  const now = input.now ?? new Date()
  const expiresAt = new Date(now.getTime() + PROVIDER_ATTEMPT_TTL_MS[input.providerKind])

  return prisma.$transaction(async (tx) => {
    // Take the singleton campaign lock before reading its state. Reading first
    // under SERIALIZABLE would let two allocators hold shared locks and then
    // deadlock while both try to upgrade for the hundredth seat.
    const locked = await tx.paidBetaCampaign.updateMany({
      where: { id: PAID_BETA_CAMPAIGN_ID },
      data: { updatedAt: now },
    })
    if (locked.count !== 1) {
      throw new Error(`PAID_BETA_CAMPAIGN_MISSING: ${PAID_BETA_CAMPAIGN_ID}`)
    }

    const campaign = await tx.paidBetaCampaign.findUnique({
      where: { id: PAID_BETA_CAMPAIGN_ID },
    })
    if (!campaign || !campaignIsActive(campaign, now)) {
      throw new PaidBetaPaymentUnavailableError()
    }

    const existing = await tx.paidBetaSeat.findUnique({
      where: {
        campaignId_userId: {
          campaignId: campaign.id,
          userId: input.userId,
        },
      },
    })
    const occupied = await tx.paidBetaSeat.count({
      where: { campaignId: campaign.id, status: { in: ['reserved', 'paid'] } },
    })
    const reusingReservedSeat = existing?.status === 'reserved'
    if (occupied >= campaign.capacity && !reusingReservedSeat) {
      throw new PaidBetaPaymentUnavailableError()
    }

    const seat = existing
      ? await tx.paidBetaSeat.update({
          where: { id: existing.id },
          data: existing.status === 'released'
            ? { status: 'reserved', releasedAt: null }
            : {},
        })
      : await tx.paidBetaSeat.create({
          data: {
            campaignId: campaign.id,
            userId: input.userId,
            status: 'reserved',
          },
        })

    const attempt = await tx.paidBetaPaymentAttempt.create({
      data: {
        seatId: seat.id,
        providerKind: input.providerKind,
        status: 'creating',
        expiresAt,
      },
    })

    return {
      attemptId: attempt.id,
      seatId: seat.id,
      campaignId: campaign.id,
      expiresAt,
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function attachPaidBetaProviderObject(
  input: {
    readonly attemptId: string
    readonly providerObjectId: string
  },
): Promise<void> {
  const updated = await prisma.paidBetaPaymentAttempt.updateMany({
    where: { id: input.attemptId, status: 'creating', providerObjectId: null },
    data: { providerObjectId: input.providerObjectId, status: 'pending' },
  })
  if (updated.count !== 1) {
    throw new Error(`PAID_BETA_ATTEMPT_ATTACH_CONFLICT: ${input.attemptId}`)
  }
}

async function releaseSeatWithoutLiveAttempts(
  tx: Prisma.TransactionClient,
  seatId: string,
  now: Date,
): Promise<void> {
  const seat = await tx.paidBetaSeat.findUnique({ where: { id: seatId } })
  if (!seat || seat.status !== 'reserved') return
  const liveAttempts = await tx.paidBetaPaymentAttempt.count({
    where: { seatId, status: { in: ['creating', 'pending'] } },
  })
  if (liveAttempts > 0) return
  await tx.paidBetaSeat.update({
    where: { id: seatId },
    data: { status: 'released', releasedAt: now },
  })
}

export async function failPaidBetaPaymentAttempt(
  attemptId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const attempt = await tx.paidBetaPaymentAttempt.findUnique({ where: { id: attemptId } })
    if (!attempt || !['creating', 'pending'].includes(attempt.status)) return
    await tx.paidBetaPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'failed', terminalAt: now },
    })
    await releaseSeatWithoutLiveAttempts(tx, attempt.seatId, now)
  })
}

export interface StalePaidBetaPaymentAttempt {
  readonly id: string
  readonly providerKind: PaidBetaProviderKind
  readonly providerObjectId: string | null
}

export async function listStalePaidBetaPaymentAttempts(
  now: Date = new Date(),
): Promise<readonly StalePaidBetaPaymentAttempt[]> {
  const rows = await prisma.paidBetaPaymentAttempt.findMany({
    where: {
      status: { in: ['creating', 'pending'] },
      expiresAt: { lte: now },
      seat: { status: 'reserved', campaignId: PAID_BETA_CAMPAIGN_ID },
    },
    orderBy: { expiresAt: 'asc' },
    take: 100,
    select: { id: true, providerKind: true, providerObjectId: true },
  })
  return rows.flatMap((row) => (
    isPaidBetaProviderKind(row.providerKind)
      ? [{ ...row, providerKind: row.providerKind }]
      : []
  ))
}

export async function expirePaidBetaPaymentAttempt(
  attemptId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const attempt = await tx.paidBetaPaymentAttempt.findUnique({ where: { id: attemptId } })
    if (!attempt || !['creating', 'pending'].includes(attempt.status)) return
    await tx.paidBetaPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'expired', terminalAt: now },
    })
    await releaseSeatWithoutLiveAttempts(tx, attempt.seatId, now)
  })
}

export type SettlePaidBetaPaymentResult =
  | { readonly status: 'paid'; readonly seatId: string }
  | { readonly status: 'already_paid'; readonly seatId: string }
  | { readonly status: 'legacy_handoff' }

/**
 * Join the paid-beta fact to the payment ledger transaction.
 *
 * Provider objects without an attempt identity are accepted only when Stripe
 * says they were created inside the campaign's finite deployment handoff
 * window. This covers provider objects created by old application instances
 * between the migration and code rollout. After that cutoff every object must
 * resolve to the exact attempt written before provider creation.
 */
export async function settlePaidBetaPaymentInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly providerObjectId: string
    readonly providerCreatedAt: Date
    readonly attemptId: string | null
  },
): Promise<SettlePaidBetaPaymentResult> {
  const campaign = await tx.paidBetaCampaign.findUnique({
    where: { id: PAID_BETA_CAMPAIGN_ID },
  })
  if (!campaign) throw new Error(`PAID_BETA_CAMPAIGN_MISSING: ${PAID_BETA_CAMPAIGN_ID}`)
  if (!input.attemptId) {
    if (input.providerCreatedAt.getTime() <= campaign.legacyPaymentCutoffAt.getTime()) {
      return { status: 'legacy_handoff' }
    }
    throw new Error('PAID_BETA_PAYMENT_ATTEMPT_REQUIRED')
  }

  const attempt = await tx.paidBetaPaymentAttempt.findUnique({
    where: { id: input.attemptId },
    include: { seat: true },
  })
  if (
    !attempt
    || attempt.providerObjectId !== input.providerObjectId
    || attempt.seat.userId !== input.userId
    || attempt.seat.campaignId !== campaign.id
  ) {
    throw new Error('PAID_BETA_PAYMENT_ATTEMPT_MISMATCH')
  }

  const alreadyPaid = attempt.seat.status === 'paid'
  const paidAt = attempt.paidAt ?? new Date()
  await tx.paidBetaPaymentAttempt.update({
    where: { id: attempt.id },
    data: { status: 'paid', paidAt, terminalAt: paidAt },
  })
  if (!alreadyPaid) {
    await tx.paidBetaSeat.update({
      where: { id: attempt.seat.id },
      data: { status: 'paid', paidAt, releasedAt: null },
    })
  }
  return {
    status: alreadyPaid ? 'already_paid' : 'paid',
    seatId: attempt.seat.id,
  }
}

export type PaidBetaPaymentAccessState = 'not_found' | 'pending' | 'paid'

export async function readPaidBetaPaymentAccessState(
  userId: string,
  providerObjectId: string,
): Promise<PaidBetaPaymentAccessState> {
  const attempt = await prisma.paidBetaPaymentAttempt.findUnique({
    where: { providerObjectId },
    include: { seat: { select: { userId: true, status: true } } },
  })
  if (!attempt || attempt.seat.userId !== userId) return 'not_found'
  return attempt.seat.status === 'paid' && attempt.status === 'paid' ? 'paid' : 'pending'
}

export async function userHasPaidBetaGroupAccess(userId: string): Promise<boolean> {
  const seat = await prisma.paidBetaSeat.findUnique({
    where: {
      campaignId_userId: {
        campaignId: PAID_BETA_CAMPAIGN_ID,
        userId,
      },
    },
    select: { status: true },
  })
  return seat?.status === 'paid'
}
