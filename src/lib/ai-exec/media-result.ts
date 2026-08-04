import { queryFalStatus } from '@/lib/ai-providers/fal/queue'

export async function queryFalGeneratedMediaStatus(input: {
  endpoint: string
  requestId: string
  apiKey: string
}) {
  return await queryFalStatus(input.endpoint, input.requestId, input.apiKey)
}
