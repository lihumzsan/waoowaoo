import { createHash } from 'node:crypto'
import { MAX_IMAGE_BYTES } from '@/lib/http/body-limits'
import { detectMimeFromBuffer } from '@/lib/media/media-mime'
import { getObjectBuffer } from '@/lib/storage'

export interface StoredImageFacts {
  readonly bytes: Buffer
  readonly mimeType: string | null
  readonly sha256: string
  readonly sizeBytes: number
}

/**
 * Read the canonical stored bytes once and derive every byte-level image fact
 * from that same bounded snapshot. Optional MediaObject metadata is a cache,
 * not an authority for attachment integrity or future materialization.
 */
export async function readStoredImageFacts(storageKey: string): Promise<StoredImageFacts> {
  const bytes = await getObjectBuffer(storageKey, { maxBytes: MAX_IMAGE_BYTES })
  return {
    bytes,
    mimeType: detectMimeFromBuffer(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  }
}
