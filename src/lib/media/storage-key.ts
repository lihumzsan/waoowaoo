/**
 * Single authority for "is this string one of our storage keys". Keys are
 * minted under these prefixes by the storage layer and task artifact writers;
 * every identity check must consume this module instead of a local copy.
 */
export const MEDIA_STORAGE_KEY_PREFIXES = ['images/', 'video/', 'audio/', 'music/'] as const

/**
 * Subset outbound image normalization accepts. Audio keys must stay rejected
 * there (fail closed) — audio bytes are never a valid provider image input.
 */
export const OUTBOUND_IMAGE_STORAGE_KEY_PREFIXES = ['images/', 'video/'] as const

export function isMediaStorageKey(value: string): boolean {
  return MEDIA_STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

export function isOutboundImageStorageKey(value: string): boolean {
  return OUTBOUND_IMAGE_STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}
