import { describe, expect, it } from 'vitest'
import {
  buildOperationExecutionWorkflowId,
  buildTaskWorkflowId,
  buildUserTaskSchedulerWorkflowId,
} from '@/lib/temporal/identity'
import { sha256Base64Url } from '@/lib/sha256'

describe('Temporal workflow identity', () => {
  it('preserves the canonical SHA-256 base64url identities', () => {
    expect(buildTaskWorkflowId('abc')).toBe(
      'task:v1:ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    )
    expect(buildUserTaskSchedulerWorkflowId('user-中文')).toBe(
      'task-scheduler:v1:EJy07oUvoEcG5wO7m6cBrqy0EOHc2pHLduy9o-oWu1A',
    )
    expect(buildOperationExecutionWorkflowId('execution-1')).toBe(
      'operation-execution:v1:Ywk8_2m4Pvsy2yCnX5k2ElKm0AIEmUKsKHZqgdJE6MY',
    )
  })

  it('rejects empty or padded identity parts', () => {
    expect(() => buildTaskWorkflowId('')).toThrow('TASK_ID_INVALID')
    expect(() => buildTaskWorkflowId(' task-1')).toThrow('TASK_ID_INVALID')
    expect(() => buildUserTaskSchedulerWorkflowId('user-1 ')).toThrow(
      'TASK_USER_ID_INVALID',
    )
  })

  it('matches SHA-256 vectors across block and UTF-8 boundaries', () => {
    expect(sha256Base64Url('')).toBe(
      '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
    )
    expect(sha256Base64Url('a'.repeat(56))).toBe(
      's1Q5pKxvCUi21vnjxq8PX1kM4g8b3nCQ73lwaG7Gc4o',
    )
    expect(sha256Base64Url('a'.repeat(1000))).toBe(
      'Qe3s5C1j6Nm_UVqbppMuHCDLyfWl0TRkWttdsblzfqM',
    )
    expect(sha256Base64Url('😀')).toBe(
      '8EQ6NCxe9UeDoRG1G6Vsk45HTDIyTZDDpgycjjo34tk',
    )
    expect(sha256Base64Url('\ud800')).toBe(
      'g9VEzMIjwFfSv4DT8qMpgsMsPA244mdIINpQZHg_sJc',
    )
  })
})
