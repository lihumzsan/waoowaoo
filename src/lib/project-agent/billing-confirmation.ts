import { prisma } from '@/lib/prisma'

/**
 * Server-side authority for whether newly proposed billable Assistant calls
 * pause for a quote card. Missing preferences preserve the safe default.
 */
export async function readAssistantBillingConfirmationRequired(userId: string): Promise<boolean> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { assistantBillingConfirmationRequired: true },
  })
  return preference?.assistantBillingConfirmationRequired ?? true
}
