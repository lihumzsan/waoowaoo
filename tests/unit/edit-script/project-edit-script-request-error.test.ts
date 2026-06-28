import { describe, expect, it } from 'vitest'
import {
  ProjectEditScriptRequestError,
  readProjectEditScriptJsonError,
  readProjectEditScriptRequestErrorCode,
} from '@/lib/query/project-edit-script-error'

describe('project edit script request error', () => {
  it('prefers route detail code over generic api code', () => {
    const error = new ProjectEditScriptRequestError('Invalid parameters', {
      apiCode: 'INVALID_PARAMS',
      detailCode: 'EDIT_SCRIPT_GENERATION_SEGMENT_LOCKED_BY_RUNNING_VIDEO',
    })

    expect(readProjectEditScriptRequestErrorCode(error)).toBe('EDIT_SCRIPT_GENERATION_SEGMENT_LOCKED_BY_RUNNING_VIDEO')
  })

  it('preserves nested route detail code from api response payload', async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: 'INVALID_PARAMS',
        message: 'Invalid parameters',
        details: {
          code: 'EDIT_SCRIPT_GENERATION_SEGMENT_LOCKED_BY_RUNNING_VIDEO',
        },
      },
    }))

    const error = await readProjectEditScriptJsonError(response, 'fallback')

    expect(error.message).toBe('Invalid parameters')
    expect(readProjectEditScriptRequestErrorCode(error)).toBe('EDIT_SCRIPT_GENERATION_SEGMENT_LOCKED_BY_RUNNING_VIDEO')
  })
})
