import { ApiError } from '@/lib/api-errors'
import type { EditBibleStatus } from './constraints'
import { EDIT_BIBLE_STATUS } from './constraints'

export function assertEditBibleCanBeRevised(input: {
  readonly status: EditBibleStatus | string
  readonly lockedAt: Date | null
}) {
  if (input.lockedAt || input.status === EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_LOCKED',
      message: 'Confirmed edit bible cannot be revised.',
    })
  }
  if (input.status === EDIT_BIBLE_STATUS.GENERATING) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_GENERATION_ALREADY_RUNNING',
      message: 'Edit bible generation is already running.',
    })
  }
}

export function assertEditBibleReadyForConfirmation(input: {
  readonly status: EditBibleStatus | string
}) {
  if (input.status !== EDIT_BIBLE_STATUS.READY_FOR_REVIEW) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_BIBLE_CONFIRMATION_NOT_ALLOWED',
      message: `Edit bible can only be confirmed from ready_for_review; current status is ${input.status}.`,
    })
  }
}
