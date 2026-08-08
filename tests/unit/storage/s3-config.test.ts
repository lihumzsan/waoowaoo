import { afterEach, describe, expect, it } from 'vitest'
import { loadS3StorageConfig } from '@/lib/storage/s3-config'

const STORAGE_ENV_NAMES = [
  'S3_ENDPOINT',
  'S3_UPLOAD_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_FORCE_PATH_STYLE',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_SESSION_TOKEN',
] as const

const originalEnv = new Map(STORAGE_ENV_NAMES.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of STORAGE_ENV_NAMES) {
    const value = originalEnv.get(name)
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
})

describe('S3 storage configuration', () => {
  it('accepts an HTTP MinIO endpoint for local Docker storage', () => {
    process.env.S3_ENDPOINT = 'http://127.0.0.1:19000'
    process.env.S3_UPLOAD_ENDPOINT = 'http://127.0.0.1:19000'
    process.env.S3_REGION = 'us-east-1'
    process.env.S3_BUCKET = 'waoowaoo'
    process.env.S3_FORCE_PATH_STYLE = 'true'
    process.env.S3_ACCESS_KEY_ID = 'local-access-key'
    process.env.S3_SECRET_ACCESS_KEY = 'local-secret-key'
    delete process.env.S3_SESSION_TOKEN

    expect(loadS3StorageConfig()).toMatchObject({
      endpoint: 'http://127.0.0.1:19000',
      uploadEndpoint: 'http://127.0.0.1:19000',
      bucket: 'waoowaoo',
      forcePathStyle: true,
    })
  })
})
