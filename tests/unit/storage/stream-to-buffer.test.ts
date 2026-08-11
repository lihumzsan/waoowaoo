import { describe, expect, it } from 'vitest'
import { StorageObjectSizeExceededError } from '@/lib/storage/errors'
import { streamToBuffer } from '@/lib/storage/utils'

async function* chunks(values: readonly string[]): AsyncGenerator<Buffer> {
  for (const value of values) yield Buffer.from(value)
}

describe('streamToBuffer byte limit', () => {
  it('accepts a stream exactly at the limit', async () => {
    await expect(streamToBuffer(chunks(['ab', 'cde']), 5)).resolves.toEqual(Buffer.from('abcde'))
  })

  it('stops before concatenating a stream beyond the limit', async () => {
    await expect(streamToBuffer(chunks(['abc', 'def']), 5)).rejects.toBeInstanceOf(
      StorageObjectSizeExceededError,
    )
  })
})
