import type { S3ClientConfig } from '@aws-sdk/client-s3'
import { StorageConfigError } from '@/lib/storage/errors'
import { requireEnv } from '@/lib/storage/utils'

const DEFAULT_S3_REGION = 'us-east-1'

export type S3StorageConfig = {
  readonly endpoint: string
  readonly uploadEndpoint: string
  readonly region: string
  readonly bucket: string
  readonly forcePathStyle: boolean
  readonly credentials: {
    readonly accessKeyId: string
    readonly secretAccessKey: string
    readonly sessionToken?: string
  }
}

function parseHttpsEndpoint(name: string, rawEndpoint: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    throw new StorageConfigError(`${name} must be a valid absolute URL`)
  }

  if (endpoint.protocol !== 'https:') {
    throw new StorageConfigError(`${name} must use HTTPS`)
  }
  if (endpoint.username || endpoint.password) {
    throw new StorageConfigError(`${name} must not contain credentials`)
  }
  if (endpoint.search || endpoint.hash) {
    throw new StorageConfigError(`${name} must not contain query parameters or a fragment`)
  }
  if (endpoint.pathname !== '/' && endpoint.pathname !== '') {
    throw new StorageConfigError(`${name} must not contain a path`)
  }

  return endpoint.origin
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
    endpoint: parseHttpsEndpoint('S3_ENDPOINT', requireEnv('S3_ENDPOINT')),
    uploadEndpoint: parseHttpsEndpoint('S3_UPLOAD_ENDPOINT', requireEnv('S3_UPLOAD_ENDPOINT')),
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

export function toS3ClientConfig(config: S3StorageConfig, endpoint: string): S3ClientConfig {
  return {
    endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
    followRegionRedirects: false,
    maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }
}
