import { assertEditSourceRange } from '@/lib/edit-source-document'
import { ledgerSchema, type Ledger } from './schemas'

export function validateLedgerAgainstSourceText(input: {
  readonly ledger: unknown
  readonly sourceText: string
}): Ledger {
  const ledger = ledgerSchema.parse(input.ledger)
  let previousStart = -1
  const eventIds = new Set<string>()
  for (const event of ledger.events) {
    assertEditSourceRange(input.sourceText, event)
    if (eventIds.has(event.eventId)) {
      throw new Error(`LEDGER_EVENT_ID_DUPLICATED:${event.eventId}`)
    }
    eventIds.add(event.eventId)
    if (event.sourceStart < previousStart) {
      throw new Error(`LEDGER_EVENT_ORDER_INVALID:${event.eventId}`)
    }
    previousStart = event.sourceStart
  }
  return ledger
}
