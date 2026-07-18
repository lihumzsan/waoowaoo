import { describe, expect, it } from 'vitest'
import { decodeBase64WithLimit, readResponseBufferWithLimit } from '@/lib/http/body-limits'

describe('bounded HTTP body readers', () => {
  it('rejects base64 before decoding when the decoded payload exceeds the limit', () => {
    const encoded = Buffer.alloc(9, 1).toString('base64')
    expect(() => decodeBase64WithLimit(encoded, 8, 'test payload')).toThrow('exceeds the 8 byte limit')
  })

  it('rejects invalid base64 instead of silently accepting truncated bytes', () => {
    expect(() => decodeBase64WithLimit('not base64!', 1024, 'test payload')).toThrow('not valid base64')
  })

  it('cancels a chunked response after it crosses the runtime byte limit', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.close()
      },
    }))
    await expect(readResponseBufferWithLimit(response, 5, 'chunked response'))
      .rejects.toThrow('exceeds the 5 byte limit')
  })
})
