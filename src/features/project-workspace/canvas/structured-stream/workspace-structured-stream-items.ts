import type {
  StructuredStreamAdapter,
  StructuredStreamItem,
  StructuredStreamParsedItem,
} from '@/lib/structured-stream/workspace-structured-stream-adapters'

export function normalizeStructuredStreamItems(
  adapter: StructuredStreamAdapter,
  previousItems: readonly StructuredStreamItem[],
  values: readonly unknown[],
): { readonly items: readonly StructuredStreamItem[]; readonly errorMessage: string | null } {
  if (values.length === 0) return { items: previousItems, errorMessage: null }
  const byKey = new Map(previousItems.map((item) => [item.itemKey, item]))
  const nextItems = [...previousItems]
  let errorMessage: string | null = null

  values.forEach((value) => {
    let parsed: StructuredStreamParsedItem
    try {
      parsed = adapter.parseItem(value)
    } catch (error) {
      errorMessage ??= error instanceof Error ? error.message : String(error)
      return
    }
    const fallbackIndex = nextItems.length
    const itemKey = adapter.itemKey(parsed, fallbackIndex)
    const item: StructuredStreamItem = {
      adapterKey: adapter.key,
      itemKey,
      value: parsed,
      index: fallbackIndex,
    }
    const existing = byKey.get(itemKey)
    if (existing) {
      const existingIndex = nextItems.findIndex((candidate) => candidate.itemKey === itemKey)
      if (existingIndex >= 0) nextItems[existingIndex] = item
    } else {
      byKey.set(itemKey, item)
      nextItems.push(item)
    }
  })

  return { items: nextItems, errorMessage }
}
