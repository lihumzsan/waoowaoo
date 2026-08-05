export const ANNOUNCEMENT_PLACEMENTS = ['workspace_canvas'] as const
export type AnnouncementPlacement = (typeof ANNOUNCEMENT_PLACEMENTS)[number]

export interface AnnouncementDefinition {
  readonly id: string
  readonly version: number
  readonly placement: AnnouncementPlacement
  readonly surface: 'modal'
  readonly titleKey: string
  readonly bodyKey: string
  readonly actionKey: string
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly priority: number
}

const ANNOUNCEMENT_REGISTRY: readonly AnnouncementDefinition[] = [
  {
    id: 'canvas-beta-welcome',
    version: 1,
    placement: 'workspace_canvas',
    surface: 'modal',
    titleKey: 'canvasBetaWelcome.title',
    bodyKey: 'canvasBetaWelcome.body',
    actionKey: 'canvasBetaWelcome.action',
    startsAt: new Date('2026-08-05T00:00:00.000Z'),
    endsAt: null,
    priority: 100,
  },
]

function isActive(definition: AnnouncementDefinition, now: Date): boolean {
  return definition.startsAt.getTime() <= now.getTime()
    && (definition.endsAt === null || definition.endsAt.getTime() > now.getTime())
}

export function isAnnouncementPlacement(value: unknown): value is AnnouncementPlacement {
  return typeof value === 'string'
    && (ANNOUNCEMENT_PLACEMENTS as readonly string[]).includes(value)
}

export function listActiveAnnouncementDefinitions(
  placement: AnnouncementPlacement,
  now: Date = new Date(),
): readonly AnnouncementDefinition[] {
  return ANNOUNCEMENT_REGISTRY
    .filter((definition) => definition.placement === placement && isActive(definition, now))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
}

export function getActiveAnnouncementDefinition(
  announcementId: string,
  version: number,
  now: Date = new Date(),
): AnnouncementDefinition | null {
  return ANNOUNCEMENT_REGISTRY.find((definition) => (
    definition.id === announcementId
    && definition.version === version
    && isActive(definition, now)
  )) ?? null
}
