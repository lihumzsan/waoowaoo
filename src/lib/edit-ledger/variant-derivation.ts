import type { LedgerEvent } from './schemas'

export function deriveLedgerEventVariantKey(event: LedgerEvent): string {
  const entityPart = event.entities
    .map((entity) => `${entity.entityType}:${entity.entityName}`)
    .sort()
    .join('|')
  return [event.kind, entityPart, event.sourceStart, event.sourceEnd].join(':')
}
