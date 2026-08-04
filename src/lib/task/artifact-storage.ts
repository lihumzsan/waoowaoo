import { createHash } from 'node:crypto'

function requireIdentity(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`TASK_ARTIFACT_${field.toUpperCase()}_REQUIRED`)
  return normalized
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^\.+/, '')
  if (!/^[a-z0-9]{1,12}$/.test(normalized)) {
    throw new Error('TASK_ARTIFACT_EXTENSION_INVALID')
  }
  return normalized
}

/** A retry reuses the same object key instead of creating an orphan. */
export function buildTaskArtifactStorageKey(input: {
  readonly taskId: string
  readonly artifact: string
  readonly extension: string
}): string {
  const taskId = requireIdentity(input.taskId, 'taskId')
  const artifact = requireIdentity(input.artifact, 'artifact')
  const extension = normalizeExtension(input.extension)
  const taskHash = createHash('sha256').update(taskId).digest('hex').slice(0, 24)
  const artifactHash = createHash('sha256').update(artifact).digest('hex').slice(0, 24)
  return `images/task-artifacts/${taskHash}/${artifactHash}.${extension}`
}
