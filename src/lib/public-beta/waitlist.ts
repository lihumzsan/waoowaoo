import { z } from 'zod'
import { locales } from '@/i18n/routing'
import {
  normalizePhoneNumberForDestination,
  maskPhoneNumber,
} from '@/lib/auth/phone-number'
import { SMS_DESTINATION_IDS } from '@/lib/auth/sms-destinations'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { readPaidBetaCampaignView } from '@/lib/paid-beta/campaign'
import { prisma } from '@/lib/prisma'

export const PUBLIC_BETA_WAITLIST_CAMPAIGN_ID = 'public-beta-wave-1'

export const publicBetaWaitlistRequestSchema = z.object({
  destinationId: z.enum(SMS_DESTINATION_IDS),
  phoneNumber: z.string().trim().min(1).max(64),
  locale: z.enum(locales),
  consent: z.literal(true),
}).strict()

export type PublicBetaWaitlistRequest = z.infer<typeof publicBetaWaitlistRequestSchema>

export type PublicBetaWaitlistErrorCode =
  | 'unavailable'
  | 'invalid_input'
  | 'not_open'

export class PublicBetaWaitlistError extends Error {
  readonly code: PublicBetaWaitlistErrorCode

  constructor(code: PublicBetaWaitlistErrorCode) {
    super(`PUBLIC_BETA_WAITLIST_${code.toUpperCase()}`)
    this.name = 'PublicBetaWaitlistError'
    this.code = code
  }
}

export function publicBetaWaitlistIsEnabled(): boolean {
  return getDeploymentFeatures(getDeploymentConfig()).showPublicBetaWaitlist
}

export async function joinPublicBetaWaitlist(
  input: PublicBetaWaitlistRequest,
): Promise<{ readonly status: 'registered'; readonly maskedPhone: string }> {
  if (!publicBetaWaitlistIsEnabled()) {
    throw new PublicBetaWaitlistError('unavailable')
  }

  const phoneE164 = normalizePhoneNumberForDestination(
    input.phoneNumber,
    input.destinationId,
  )
  if (!phoneE164 || input.consent !== true) {
    throw new PublicBetaWaitlistError('invalid_input')
  }

  const paidBetaCampaign = await readPaidBetaCampaignView()
  if (!paidBetaCampaign.soldOut) {
    throw new PublicBetaWaitlistError('not_open')
  }

  const now = new Date()
  await prisma.publicBetaWaitlistEntry.upsert({
    where: {
      campaignId_phoneE164: {
        campaignId: PUBLIC_BETA_WAITLIST_CAMPAIGN_ID,
        phoneE164,
      },
    },
    create: {
      campaignId: PUBLIC_BETA_WAITLIST_CAMPAIGN_ID,
      phoneE164,
      locale: input.locale,
      source: 'pricing_sold_out',
      consentedAt: now,
    },
    update: {},
  })

  return {
    status: 'registered',
    maskedPhone: maskPhoneNumber(phoneE164),
  }
}
