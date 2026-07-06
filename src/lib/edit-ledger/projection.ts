import { ledgerSnapshotSchema, type Ledger, type LedgerSnapshot } from './schemas'

function entityKey(entity: { readonly entityType: string; readonly entityName: string }): string {
  return `${entity.entityType}:${entity.entityName}`
}

export function projectLedgerSnapshotAtSourceOffset(input: {
  readonly ledger: Ledger
  readonly sourceEnd: number
}): LedgerSnapshot {
  const facts = new Map<string, string>()
  const entities = new Map<string, LedgerSnapshot['entities'][number]>()
  for (const event of input.ledger.events) {
    if (event.sourceEnd > input.sourceEnd) continue
    for (const fact of event.persistentFacts) {
      facts.set(fact, fact)
    }
    for (const entity of event.entities) {
      entities.set(entityKey(entity), entity)
    }
  }
  return ledgerSnapshotSchema.parse({
    sourceEnd: input.sourceEnd,
    facts: Array.from(facts.values()),
    entities: Array.from(entities.values()),
  })
}

export function collectLedgerEventsInRange(input: {
  readonly ledger: Ledger
  readonly sourceStart: number
  readonly sourceEnd: number
}): readonly Ledger['events'][number][] {
  return input.ledger.events.filter((event) => (
    event.sourceStart >= input.sourceStart && event.sourceEnd <= input.sourceEnd
  ))
}
