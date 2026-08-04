import { getStorageProvider } from '@/lib/storage'

export async function ensureStorageReady(): Promise<void> {
  await getStorageProvider().verifyReady()
}
