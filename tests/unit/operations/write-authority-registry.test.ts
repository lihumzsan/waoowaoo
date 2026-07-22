import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { assertAssistantToolWriteAuthority } from '@/lib/operations/write-authority'

describe('Assistant Tool write authority registry', () => {
  it('classifies every real Tool-visible write under exactly one commit authority', () => {
    const operations = Object.values(createProjectAgentOperationRegistry())
      .filter((operation) => operation.channels.tool && operation.effects.writes)

    expect(operations.length).toBeGreaterThan(0)
    for (const operation of operations) {
      expect(() => assertAssistantToolWriteAuthority(
        operation.id,
        operation as unknown as Record<string, unknown>,
      ), operation.id).not.toThrow()

      const authorities = [
        operation.confirmation.kind === 'billable_media',
        typeof operation.executeInTransaction === 'function',
        operation.assistantWriteAuthority?.kind === 'transactional_task_submission',
      ].filter(Boolean)
      expect(authorities, operation.id).toHaveLength(1)
      expect(
        typeof operation.execute === 'function' && !operation.assistantWriteAuthority,
        operation.id,
      ).toBe(false)
    }
  })

  it('keeps non-transactional destructive legacy paths fail-closed outside Tool channel', () => {
    const registry = createProjectAgentOperationRegistry()
    const restricted = [
      'cancel_task',
      'delete_project',
    ]

    for (const operationId of restricted) {
      expect(registry[operationId]?.channels, operationId).toEqual({ tool: false, api: true })
    }
  })

  it('rejects an ordinary Tool write executor with no transactional or idempotent authority', () => {
    expect(() => assertAssistantToolWriteAuthority('unsafe_write', {
      channels: { tool: true, api: true },
      effects: { writes: true },
      confirmation: { kind: 'none', required: false },
      execute: async () => ({ ok: true }),
    })).toThrow('PROJECT_AGENT_OPERATION_TOOL_WRITE_AUTHORITY_REQUIRED:unsafe_write')
  })
})
