import { createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { addBalanceWithTransaction } from '@/lib/billing/ledger'

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300

type StripeWebhookAction = 'credited' | 'ignored'

export interface StripeWebhookHandleResult {
  received: true
  action: StripeWebhookAction
  eventType: string
  sessionId?: string
  credits?: number
  reason?: string
}

interface StripeCheckoutSessionLike {
  id: string
  paymentStatus: string | null
  metadata: Record<string, string>
}

function readStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('STRIPE_WEBHOOK_SECRET_REQUIRED')
  }
  return secret.trim()
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  const pairs = header.split(',').map((part) => part.trim()).filter(Boolean)
  const timestampRaw = pairs
    .map((pair) => pair.split('='))
    .find(([key]) => key === 't')?.[1]
  const timestamp = Number(timestampRaw)
  const signatures = pairs
    .map((pair) => pair.split('='))
    .filter(([key, value]) => key === 'v1' && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value)
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new Error('STRIPE_SIGNATURE_HEADER_INVALID')
  }
  return { timestamp, signatures }
}

function secureCompareHex(expectedHex: string, receivedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex')
  const received = Buffer.from(receivedHex, 'hex')
  if (expected.length !== received.length) return false
  return timingSafeEqual(expected, received)
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret = readStripeWebhookSecret(),
  nowMs = Date.now(),
): void {
  if (!signatureHeader) {
    throw new Error('STRIPE_SIGNATURE_HEADER_REQUIRED')
  }
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader)
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestamp)
  if (ageSeconds > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error('STRIPE_SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE')
  }
  const signedPayload = `${timestamp}.${rawBody}`
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex')
  const matched = signatures.some((signature) => secureCompareHex(expected, signature))
  if (!matched) {
    throw new Error('STRIPE_SIGNATURE_MISMATCH')
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readMetadata(value: unknown): Record<string, string> {
  const record = readRecord(value)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function readCheckoutSession(value: unknown): StripeCheckoutSessionLike {
  const record = readRecord(value)
  if (!record) {
    throw new Error('STRIPE_CHECKOUT_SESSION_INVALID')
  }
  const id = readString(record.id)
  if (!id) {
    throw new Error('STRIPE_CHECKOUT_SESSION_ID_REQUIRED')
  }
  return {
    id,
    paymentStatus: readString(record.payment_status),
    metadata: readMetadata(record.metadata),
  }
}

function readPositiveMetadataNumber(metadata: Record<string, string>, key: string): number {
  const value = Number(metadata[key])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`STRIPE_CHECKOUT_METADATA_${key.toUpperCase()}_INVALID`)
  }
  return value
}

async function creditCheckoutSession(session: StripeCheckoutSessionLike): Promise<StripeWebhookHandleResult> {
  if (session.metadata.waoowaoo_kind !== 'credit_recharge') {
    return {
      received: true,
      action: 'ignored',
      eventType: 'checkout.session',
      sessionId: session.id,
      reason: 'unmanaged_checkout_session',
    }
  }
  if (session.paymentStatus !== 'paid') {
    return {
      received: true,
      action: 'ignored',
      eventType: 'checkout.session',
      sessionId: session.id,
      reason: 'payment_not_paid',
    }
  }

  const userId = readString(session.metadata.user_id)
  if (!userId) {
    throw new Error('STRIPE_CHECKOUT_METADATA_USER_ID_REQUIRED')
  }
  const credits = readPositiveMetadataNumber(session.metadata, 'credits')

  await prisma.$transaction(async (tx) => {
    await addBalanceWithTransaction(tx, userId, credits, {
      type: 'recharge',
      reason: 'stripe checkout recharge',
      externalOrderId: session.id,
      idempotencyKey: `stripe:checkout:${session.id}`,
    })
  })

  return {
    received: true,
    action: 'credited',
    eventType: 'checkout.session',
    sessionId: session.id,
    credits,
  }
}

function parseStripeEvent(rawBody: string): { id: string; type: string; object: unknown } {
  const payload: unknown = JSON.parse(rawBody)
  const record = readRecord(payload)
  if (!record) {
    throw new Error('STRIPE_EVENT_INVALID')
  }
  const id = readString(record.id)
  const type = readString(record.type)
  const data = readRecord(record.data)
  if (!id || !type || !data) {
    throw new Error('STRIPE_EVENT_MISSING_REQUIRED_FIELDS')
  }
  return {
    id,
    type,
    object: data.object,
  }
}

export async function handleStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<StripeWebhookHandleResult> {
  verifyStripeWebhookSignature(rawBody, signatureHeader)
  const event = parseStripeEvent(rawBody)

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = readCheckoutSession(event.object)
    const result = await creditCheckoutSession(session)
    return {
      ...result,
      eventType: event.type,
    }
  }

  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
    const session = readCheckoutSession(event.object)
    return {
      received: true,
      action: 'ignored',
      eventType: event.type,
      sessionId: session.id,
      reason: event.type,
    }
  }

  return {
    received: true,
    action: 'ignored',
    eventType: event.type,
    reason: 'unhandled_event_type',
  }
}
