import { prisma } from '@/lib/prisma'
import {
  getActiveAnnouncementDefinition,
  listActiveAnnouncementDefinitions,
  type AnnouncementPlacement,
} from './registry'

export interface AnnouncementView {
  readonly id: string
  readonly version: number
  readonly surface: 'modal'
  readonly titleKey: string
  readonly bodyKey: string
  readonly actionKey: string
}

export async function readPendingAnnouncementViews(
  userId: string,
  placement: AnnouncementPlacement,
): Promise<readonly AnnouncementView[]> {
  const definitions = listActiveAnnouncementDefinitions(placement)
  if (definitions.length === 0) return []
  const receipts = await prisma.announcementReceipt.findMany({
    where: {
      userId,
      OR: definitions.map((definition) => ({
        announcementId: definition.id,
        version: definition.version,
      })),
    },
    select: { announcementId: true, version: true },
  })
  const acknowledged = new Set(
    receipts.map((receipt) => `${receipt.announcementId}:${receipt.version}`),
  )
  return definitions
    .filter((definition) => !acknowledged.has(`${definition.id}:${definition.version}`))
    .map((definition) => ({
      id: definition.id,
      version: definition.version,
      surface: definition.surface,
      titleKey: definition.titleKey,
      bodyKey: definition.bodyKey,
      actionKey: definition.actionKey,
    }))
}

export async function acknowledgeAnnouncement(
  userId: string,
  announcementId: string,
  version: number,
): Promise<'acknowledged' | 'not_available'> {
  if (!getActiveAnnouncementDefinition(announcementId, version)) return 'not_available'
  await prisma.announcementReceipt.upsert({
    where: {
      userId_announcementId_version: { userId, announcementId, version },
    },
    create: { userId, announcementId, version },
    update: {},
  })
  return 'acknowledged'
}
