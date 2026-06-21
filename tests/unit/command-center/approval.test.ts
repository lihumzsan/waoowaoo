import { describe, expect, it } from 'vitest'
import { buildExecutionPlanDraft } from '@/lib/command-center/plan-builder'
import { normalizeCommandEnvelope, resolvePlanApprovalRequirement } from '@/lib/command-center/executor'

describe('command-center approval routing', () => {
  it('run_operation commands keep baseline approval behavior', () => {
    const command = normalizeCommandEnvelope({
      projectId: 'project-1',
      body: {
        commandType: 'run_operation',
        source: 'gui',
        operationId: 'panel_variant',
        episodeId: 'episode-1',
        scopeRef: 'panel:panel-1',
        input: {
          panelId: 'panel-1',
        },
      },
    })
    const plan = buildExecutionPlanDraft(command)

    expect(resolvePlanApprovalRequirement(command, plan)).toBe(false)
  })
})
