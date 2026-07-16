import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { getProviderConfig } from '@/lib/user-api/runtime-config'

export async function resolveVideoDownloadHeaders(
  userId: string,
  modelId: string,
  source: string,
  generatedHeaders?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  if (generatedHeaders) return generatedHeaders
  const parsedModel = parseModelKeyStrict(modelId)
  const isGoogleDownloadUrl = source.includes('generativelanguage.googleapis.com/')
    && source.includes('/files/')
    && source.includes(':download')
  if (parsedModel?.provider !== 'google' || !isGoogleDownloadUrl) return undefined
  const { apiKey } = await getProviderConfig(userId, 'google')
  return { 'x-goog-api-key': apiKey }
}
