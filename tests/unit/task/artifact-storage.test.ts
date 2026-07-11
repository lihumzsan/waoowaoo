import { describe, expect, it } from 'vitest'
import { buildTaskArtifactStorageKey } from '@/lib/task/artifact-storage'

describe('Task artifact storage identity', () => {
  it('is stable for replay and separates task/artifact identities', () => {
    const first = buildTaskArtifactStorageKey({ taskId: 'task-1', artifact: 'image:primary', extension: '.PNG' })
    expect(buildTaskArtifactStorageKey({ taskId: 'task-1', artifact: 'image:primary', extension: 'png' })).toBe(first)
    expect(buildTaskArtifactStorageKey({ taskId: 'task-2', artifact: 'image:primary', extension: 'png' })).not.toBe(first)
    expect(buildTaskArtifactStorageKey({ taskId: 'task-1', artifact: 'image:secondary', extension: 'png' })).not.toBe(first)
    expect(first).toMatch(/^images\/task-artifacts\/[a-f0-9]{24}\/[a-f0-9]{24}\.png$/)
  })

  it('fails on missing identity or unsafe extension', () => {
    expect(() => buildTaskArtifactStorageKey({ taskId: '', artifact: 'primary', extension: 'png' }))
      .toThrow('TASK_ARTIFACT_TASKID_REQUIRED')
    expect(() => buildTaskArtifactStorageKey({ taskId: 'task-1', artifact: '', extension: 'png' }))
      .toThrow('TASK_ARTIFACT_ARTIFACT_REQUIRED')
    expect(() => buildTaskArtifactStorageKey({ taskId: 'task-1', artifact: 'primary', extension: '../png' }))
      .toThrow('TASK_ARTIFACT_EXTENSION_INVALID')
  })
})
