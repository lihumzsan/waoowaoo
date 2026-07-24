import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { WORKSPACE_RESOURCE_IMPACT } from '@/lib/workspace-resource/resource-impact'

describe('project agent operation registry', () => {
  it('keeps operation ids aligned and core fields defined', () => {
    const registry = createProjectAgentOperationRegistry()
    for (const [id, operation] of Object.entries(registry)) {
      expect(operation.id).toBe(id)
      expect(operation.summary.trim().length).toBeGreaterThan(0)
      expect(operation.groupPath.length).toBeGreaterThan(0)
      expect(typeof operation.channels.tool).toBe('boolean')
      expect(typeof operation.channels.api).toBe('boolean')
      expect(['required', 'optional', 'forbidden']).toContain(operation.prerequisites.episodeId)
      expect(typeof operation.confirmation.required).toBe('boolean')
      expect(typeof operation.effects.writes).toBe('boolean')
      if (operation.effects.writes) {
        expect(Object.values(WORKSPACE_RESOURCE_IMPACT), operation.id).toContain(
          operation.effects.workspaceResourceImpact,
        )
        if (operation.confirmation.kind === 'billable_media') {
          expect(operation.plan, operation.id).toBeTypeOf('function')
          expect(operation.commit, operation.id).toBeTypeOf('function')
        } else {
          expect(operation.executeInTransaction ?? operation.execute, operation.id).toBeTypeOf('function')
        }
      } else {
        expect(operation.effects.workspaceResourceImpact, operation.id).toBeUndefined()
      }
      expect(typeof operation.effects.billable).toBe('boolean')
      expect(typeof operation.effects.destructive).toBe('boolean')
      expect(typeof operation.effects.overwrite).toBe('boolean')
      expect(typeof operation.effects.bulk).toBe('boolean')
      expect(typeof operation.effects.externalSideEffects).toBe('boolean')
      expect(typeof operation.effects.longRunning).toBe('boolean')
      expect(['none', 'resource']).toContain(operation.resourceContract.kind)
      expect(operation.inputSchema).toBeDefined()
      expect(operation.outputSchema).toBeDefined()
      expect(typeof operation.inputSchema.safeParse).toBe('function')
      expect(typeof operation.outputSchema.safeParse).toBe('function')
    }
  })

  it('registers freeform creative delegation and one model-authored Choice surface', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.delegate_creative_work).toMatchObject({
      channels: { tool: true, api: false },
      groupPath: ['assistant', 'creative'],
      confirmation: { kind: 'none', required: false },
      effects: { writes: true, longRunning: true },
    })
    expect(registry.request_choice).toMatchObject({
      channels: { tool: true, api: false },
      groupPath: ['assistant', 'choice'],
      intent: 'query',
      agentFlow: { suspendsFor: 'choice' },
      effects: { writes: false },
    })
  })

  it('keeps adoption and Chapter planning as explicit current operations', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.adopt_story_canon).toMatchObject({
      channels: { tool: true, api: false },
      groupPath: ['assistant', 'creative'],
      choiceCommit: { enabled: true },
    })
    expect(registry.adopt_style_bible).toMatchObject({
      channels: { tool: true, api: false },
      groupPath: ['assistant', 'creative'],
      choiceCommit: { enabled: true },
    })
    expect(registry.adopt_chapters).toMatchObject({
      channels: { tool: true, api: false },
      groupPath: ['assistant', 'creative'],
      choiceCommit: { enabled: true },
      effects: { bulk: false, longRunning: false },
    })
  })

  it('keeps project video ratio as one Choice-eligible config fact', () => {
    const operation = createProjectAgentOperationRegistry().update_project_config

    expect(operation).toMatchObject({
      intent: 'act',
      channels: { tool: true, api: true },
      choiceCommit: { enabled: true },
      confirmation: { kind: 'none', required: false },
      effects: {
        writes: true,
        billable: false,
        destructive: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
    })
    expect(operation.executeInTransaction).toBeTypeOf('function')
  })

  it('limits project reads to current projections and exact Resource working sets', () => {
    const registry = createProjectAgentOperationRegistry()

    expect(registry.get_project_snapshot.summary).toContain(
      'only when the injected project_state_snapshot and conversation context are insufficient',
    )
    expect(registry.get_project_context.summary).toContain('exact adopted screenplay and Bible revisions')
    expect(registry.get_project_context.summary).toContain('optional Chapter context units')
    expect(registry.get_project_context.summary).toContain('never infer current adoption')
  })

  it('gives every billable media operation exactly one plan-and-commit execution path', () => {
    const registry = createProjectAgentOperationRegistry()
    const billable = Object.values(registry).filter((operation) => operation.confirmation.kind === 'billable_media')

    expect(billable.length).toBeGreaterThan(0)
    for (const operation of billable) {
      expect(operation.plan, operation.id).toBeTypeOf('function')
      expect(operation.commit, operation.id).toBeTypeOf('function')
      expect(operation.execute, operation.id).toBeUndefined()
      expect(operation.executeInTransaction, operation.id).toBeUndefined()
      expect(operation.effects.workspaceResourceImpact, operation.id).toBeDefined()
    }
  })

  it('registers generic media Resource creation under one approval contract', () => {
    const registry = createProjectAgentOperationRegistry()

    for (const operationId of ['create_image', 'create_audio', 'create_video'] as const) {
      const operation = registry[operationId]
      expect(operation.channels).toEqual({ tool: true, api: true })
      expect(operation.groupPath).toEqual(['resource'])
      expect(operation.confirmation).toMatchObject({ kind: 'billable_media', required: true })
      expect(operation.effects).toMatchObject({
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        externalSideEffects: true,
        longRunning: true,
      })
    }
  })

  it('registers deterministic video merging as a generic Resource task', () => {
    const operation = createProjectAgentOperationRegistry().merge_videos

    expect(operation.channels).toEqual({ tool: true, api: true })
    expect(operation.groupPath).toEqual(['resource'])
    expect(operation.confirmation).toMatchObject({ kind: 'none', required: false })
    expect(operation.effects).toMatchObject({
      writes: true,
      billable: false,
      externalSideEffects: true,
      longRunning: true,
    })
    expect(operation.resourceContract).toMatchObject({
      kind: 'resource',
      outputMediaTypes: ['video'],
      supportsCandidates: false,
    })
  })
})
