import { StorageConfigError } from '@/lib/storage/errors'
import { LocalStorageProvider } from '@/lib/storage/providers/local'
import { MinioStorageProvider } from '@/lib/storage/providers/minio'
import type { StorageFactoryOptions, StorageProvider, StorageType } from '@/lib/storage/types'

function normalizeStorageType(rawType: string | undefined): StorageType {
  const normalized = (rawType || 'minio').trim().toLowerCase()
  if (normalized === 'minio' || normalized === 'local') {
    return normalized
  }
  throw new StorageConfigError(`Unsupported STORAGE_TYPE: ${rawType}`)
}

export function createStorageProvider(options: StorageFactoryOptions = {}): StorageProvider {
  const type = normalizeStorageType(options.storageType || process.env.STORAGE_TYPE)

  if (type === 'minio') {
    return new MinioStorageProvider()
  }
  return new LocalStorageProvider()
}
