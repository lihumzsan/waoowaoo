import type { S3ClientConfig } from '@aws-sdk/client-s3'
import { StorageConfigError } from '@/lib/storage/errors'
import { requireEnv } from '@/lib/storage/utils'

const DEFAULT_S3_REGION = 'us-east-1'

export type S3StorageConfig = {
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly forcePathStyle: boolean
  readonly credentials: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string
  }
}

function parseS3Endpoint(rawEndpoint: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    throw new StorageConfigError('S3_ENDPOINT must be a valid absolute URL')
  }

  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new StorageConfigError('S3_ENDPOINT must use HTTP or HTTPS')
  }
  return endpoint.toString().replace(/\/$/, '')
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name]?.trim().toLowerCase()
  if (!rawValue) return defaultValue
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  throw new StorageConfigError(`${name} must be "true" or "false"`)
}

export function loadS3StorageConfig(): S3StorageConfig {
  const sessionToken = process.env.S3_SESSION_TOKEN?.trim()
  return {
    endpoint: parseS3Endpoint(requireEnv('S3_ENDPOINT')),
    region: process.env.S3_REGION?.trim() || DEFAULT_S3_REGION,
    bucket: requireEnv('S3_BUCKET'),
    forcePathStyle: parseBooleanEnv('S3_FORCE_PATH_STYLE', false),
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      ...(sessionToken ? { sessionToken } : {}),
    },
  }
}

export function toS3ClientConfig(config: S3StorageConfig): S3ClientConfig {
  return {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
    followRegionRedirects: false,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }
}
