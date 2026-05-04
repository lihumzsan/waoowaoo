import { StorageProviderNotImplementedError } from '@/lib/storage/errors'
import type { DeleteObjectsResult, SignedUrlParams, StorageProvider, UploadObjectParams, UploadObjectResult } from '@/lib/storage/types'

export class CosStorageProvider implements StorageProvider {
  readonly kind = 'cos' as const

  constructor() {
    throw new StorageProviderNotImplementedError('cos')
  }

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    void params
    throw new StorageProviderNotImplementedError('cos')
  }

  async deleteObject(key: string): Promise<void> {
    void key
    throw new StorageProviderNotImplementedError('cos')
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    void keys
    throw new StorageProviderNotImplementedError('cos')
  }

  async getSignedObjectUrl(params: SignedUrlParams): Promise<string> {
    void params
    throw new StorageProviderNotImplementedError('cos')
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    void key
    throw new StorageProviderNotImplementedError('cos')
  }

  extractStorageKey(input: string | null | undefined): string | null {
    void input
    throw new StorageProviderNotImplementedError('cos')
  }

  toFetchableUrl(inputUrl: string): string {
    void inputUrl
    throw new StorageProviderNotImplementedError('cos')
  }

  generateUniqueKey(params: { prefix: string; ext: string }): string {
    void params
    throw new StorageProviderNotImplementedError('cos')
  }
}
