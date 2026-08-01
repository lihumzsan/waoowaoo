import { readClientApiError } from '@/lib/errors/client'

export async function readProjectStoryCanonJsonError(response: Response): Promise<Error> {
  return await readClientApiError(response)
}
