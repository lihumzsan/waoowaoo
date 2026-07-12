import type { LedgerEvent } from '@/lib/edit-ledger'

export function projectChapterPersistentFacts(
  events: readonly LedgerEvent[],
): readonly string[] {
  const facts = new Set<string>()
  for (const event of events) {
    for (const fact of event.persistentFacts) {
      facts.add(fact)
    }
  }
  return Array.from(facts)
}
