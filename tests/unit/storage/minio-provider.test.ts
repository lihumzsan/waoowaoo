import { describe, expect, it } from 'vitest'
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
})
