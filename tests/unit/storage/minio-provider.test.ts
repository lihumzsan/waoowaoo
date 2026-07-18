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

  it('passes a web stream and declared length to the S3 put command once', async () => {
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
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
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
      Body: body,
      ContentLength: 3,
      ContentType: 'video/mp4',
    }])
    expect(send).toHaveBeenCalledTimes(1)
  })
})
