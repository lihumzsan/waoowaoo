import { getStorageProvider } from '@/lib/storage'

export async function ensureStorageReady(): Promise<'created' | 'existing'> {
  return await getStorageProvider().ensureBucket()
}
