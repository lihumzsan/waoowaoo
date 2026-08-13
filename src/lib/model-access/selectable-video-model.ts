import { ApiError } from '@/lib/api-errors'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'

export async function requireSelectableVideoModel(
  userId: string,
  modelKey: string,
): Promise<string> {
  try {
    const selection = await resolveModelSelection(userId, modelKey, 'video')
    return selection.modelKey
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.startsWith('MODEL_KEY_INVALID:')
        || error.message.startsWith('MODEL_NOT_FOUND:')
      )
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PROJECT_VIDEO_MODEL_NOT_AVAILABLE',
        field: 'videoModel',
      }, { cause: error })
    }
    throw error
  }
}
