import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { MinioStorageProvider } from '@/lib/storage/providers/minio'

describe('minio storage provider', () => {
  function createProvider() {
    process.env.MINIO_ENDPOINT = 'http://127.0.0.1:9000'
    process.env.MINIO_REGION = 'us-east-1'
    process.env.MINIO_BUCKET = 'waoowaoo'
    process.env.MINIO_ACCESS_KEY = 'minioadmin'
    process.env.MINIO_SECRET_KEY = 'minioadmin'
    process.env.MINIO_FORCE_PATH_STYLE = 'true'
    return new MinioStorageProvider()
  }

  it('extracts storage keys from relative signed proxy urls', () => {
    const provider = createProvider()

    expect(
      provider.extractStorageKey('/api/storage/sign?key=images%2Fvoice%2Fcustom%2Fproject-1%2Fchenji.wav&expires=3600'),
    ).toBe('images/voice/custom/project-1/chenji.wav')
  })

  it('extracts storage keys from absolute bucket urls', () => {
    const provider = createProvider()

    expect(
      provider.extractStorageKey('http://127.0.0.1:9000/waoowaoo/images/voice/custom/project-1/chenji.wav'),
    ).toBe('images/voice/custom/project-1/chenji.wav')
  })

  it('passes a non-flowing node stream and declared length to the S3 put command once', async () => {
    const provider = createProvider()
    const send = vi.fn(async () => undefined)
    const putInputs: Record<string, unknown>[] = []
    class PutObjectCommand {
      constructor(input: Record<string, unknown>) {
        putInputs.push(input)
      }
    }
    const internals = provider as unknown as {
      loadSdk: () => Promise<unknown>
      getClient: () => Promise<unknown>
    }
    vi.spyOn(internals, 'loadSdk').mockResolvedValue({ PutObjectCommand })
    vi.spyOn(internals, 'getClient').mockResolvedValue({ send })
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
      cancel,
    })

    await provider.uploadObjectStream({
      body,
      key: 'video-tools/user-1/inputs/one.mp4',
      contentLength: 3,
      contentType: 'video/mp4',
    })

    expect(putInputs).toEqual([{
      Bucket: 'waoowaoo',
      Key: 'video-tools/user-1/inputs/one.mp4',
      Body: expect.any(Readable),
      ContentLength: 3,
      ContentType: 'video/mp4',
    }])
    expect(putInputs[0]?.Body).not.toBe(body)
    expect((putInputs[0]?.Body as Readable).readableFlowing).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('cancels and unlocks the web stream when S3 send fails before consuming the node adapter', async () => {
    const provider = createProvider()
    const sendError = new Error('send failed immediately')
    const send = vi.fn(async () => {
      throw sendError
    })
    class PutObjectCommand {}
    const internals = provider as unknown as {
      loadSdk: () => Promise<unknown>
      getClient: () => Promise<unknown>
    }
    vi.spyOn(internals, 'loadSdk').mockResolvedValue({ PutObjectCommand })
    vi.spyOn(internals, 'getClient').mockResolvedValue({ send })
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed')
    })
    const body = new ReadableStream<Uint8Array>({ cancel })

    await expect(provider.uploadObjectStream({
      body,
      key: 'video-tools/user-1/inputs/failed.mp4',
      contentLength: 3,
      contentType: 'video/mp4',
    })).rejects.toBe(sendError)

    expect(send).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(body.locked).toBe(false)
  })

  it('reaches a local server through the real AWS SDK middleware without pre-consuming or retrying the stream', async () => {
    let requestCount = 0
    let receivedBytes = 0
    const server = createServer((request, response) => {
      requestCount += 1
      request.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.byteLength
      })
      request.on('end', () => {
        response.statusCode = 200
        response.setHeader('ETag', '"test-etag"')
        response.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address() as AddressInfo
      process.env.MINIO_ENDPOINT = `http://127.0.0.1:${address.port}`
      process.env.MINIO_REGION = 'us-east-1'
      process.env.MINIO_BUCKET = 'waoowaoo'
      process.env.MINIO_ACCESS_KEY = 'minioadmin'
      process.env.MINIO_SECRET_KEY = 'minioadmin'
      process.env.MINIO_FORCE_PATH_STYLE = 'true'
      const provider = new MinioStorageProvider()
      let sourceChunkReads = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sourceChunkReads === 0) {
            sourceChunkReads += 1
            controller.enqueue(new Uint8Array([1, 2, 3]))
            return
          }
          controller.close()
        },
      })

      await provider.uploadObjectStream({
        body,
        key: 'video-tools/user-1/inputs/real-sdk.mp4',
        contentLength: 3,
        contentType: 'video/mp4',
      })

      expect(requestCount).toBe(1)
      expect(sourceChunkReads).toBe(1)
      expect(receivedBytes).toBeGreaterThan(0)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
