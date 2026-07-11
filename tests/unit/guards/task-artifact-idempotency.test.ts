import { describe, expect, it } from 'vitest'
import { inspectTaskArtifactSource } from '../../../scripts/guards/task-artifact-idempotency-guard.mjs'

describe('task artifact idempotency guard', () => {
  it('accepts stable direct and helper uploads', () => {
    expect(inspectTaskArtifactSource({
      file: 'src/lib/workers/example.ts',
      content: [
        "const key = buildTaskArtifactStorageKey({ taskId, artifact: 'primary', extension: 'png' })",
        'await uploadObject(buffer, key)',
        "await uploadImageSourceToCos(source, 'image', targetId, { taskId, artifact: 'primary' })",
      ].join('\n'),
    })).toEqual([])
  })

  it('rejects random and identity-free Task uploads', () => {
    expect(inspectTaskArtifactSource({
      file: 'src/lib/workers/example.ts',
      content: [
        "const key = generateUniqueKey('result', 'png')",
        'await uploadObject(buffer, key)',
        "await uploadVideoSourceToCos(source, 'video', targetId)",
      ].join('\n'),
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('timestamp/random storage key'),
      expect.stringContaining('taskId + artifact identity'),
      expect.stringContaining('buildTaskArtifactStorageKey'),
    ]))
  })
})
