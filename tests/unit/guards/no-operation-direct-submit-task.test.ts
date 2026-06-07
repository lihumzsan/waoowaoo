import { describe, expect, it } from 'vitest'
import { inspectOperationDirectSubmitTask } from '../../../scripts/guards/no-operation-direct-submit-task.mjs'

describe('no operation direct submitTask guard', () => {
  it('allows the submitOperationTask wrapper to call submitTask', () => {
    const content = `
      import { submitTask } from '@/lib/task/submitter'
      export async function submitOperationTask() {
        return await submitTask({})
      }
    `

    expect(inspectOperationDirectSubmitTask('src/lib/operations/submit-operation-task.ts', content)).toEqual([])
  })

  it('flags operation files importing submitTask directly', () => {
    const content = `
      import { submitTask } from '@/lib/task/submitter'
      export async function execute() {
        return await submitOperationTask({})
      }
    `

    expect(
      inspectOperationDirectSubmitTask('src/lib/operations/domains/media/media-ops.ts', content),
    ).toEqual([
      'src/lib/operations/domains/media/media-ops.ts imports submitTask directly; use submitOperationTask instead',
    ])
  })

  it('flags operation files calling submitTask directly', () => {
    const content = `
      import { submitOperationTask } from '@/lib/operations/submit-operation-task'
      export async function execute() {
        return await submitTask({})
      }
    `

    expect(
      inspectOperationDirectSubmitTask('src/lib/operations/domains/media/video-ops.ts', content),
    ).toEqual([
      'src/lib/operations/domains/media/video-ops.ts calls submitTask directly; use submitOperationTask instead',
    ])
  })
})
