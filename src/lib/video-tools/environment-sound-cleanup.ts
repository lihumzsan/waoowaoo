import { randomUUID } from 'node:crypto'
import type { Locale } from '@/i18n/routing'
import { addTaskJob } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import {
  ENVIRONMENT_SOUND_PROJECT_ID,
  ENVIRONMENT_SOUND_TTL_SECONDS,
  isOwnedEnvironmentSoundTemporaryObjectKey,
} from './environment-sound'

export async function scheduleEnvironmentSoundCleanup(params: {
  userId: string
  locale: Locale
  objectKey: string
}) {
  if (!isOwnedEnvironmentSoundTemporaryObjectKey(params.userId, params.objectKey)) {
    throw new Error('ENVIRONMENT_SOUND_CLEANUP_OBJECT_NOT_OWNED')
  }

  const delay = ENVIRONMENT_SOUND_TTL_SECONDS * 1000
  const expiresAt = new Date(Date.now() + delay).toISOString()
  const taskId = randomUUID()
  const data: TaskJobData = {
    taskId,
    persistence: 'transient',
    userId: params.userId,
    locale: params.locale,
    projectId: ENVIRONMENT_SOUND_PROJECT_ID,
    type: TASK_TYPE.ENVIRONMENT_SOUND_CLEANUP,
    targetType: 'EnvironmentSoundCleanup',
    targetId: randomUUID(),
    payload: { objectKey: params.objectKey },
  }
  await addTaskJob(data, {
    delay,
    attempts: 3,
    removeOnComplete: { age: 10 * 60, count: 200 },
    removeOnFail: { age: ENVIRONMENT_SOUND_TTL_SECONDS, count: 200 },
  })
  return { expiresAt, taskId }
}
