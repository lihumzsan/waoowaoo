import { describe, expect, it } from 'vitest'
import { inspectHistoryStateInference } from '../../../scripts/guards/no-history-state-inference.mjs'
import { inspectChoiceRegistryAuthority } from '../../../scripts/guards/assistant-choice-offer-authority-guard.mjs'
import { inspectProjectAgentProjectionWrites } from '../../../scripts/guards/project-agent-run-state-machine-guard.mjs'

describe('Assistant architecture guards', () => {
  it('rejects message-history continuation inference', () => {
    expect(inspectHistoryStateInference('fixture.ts', 'findPendingAgentInterruption(messages)')).toEqual([
      'fixture.ts contains findPendingAgentInterruption',
    ])
  })

  it('rejects a private Choice stage map and renderer type switch', () => {
    const violations = inspectChoiceRegistryAuthority({
      choiceRegistry: `
        const EDIT_FIRST_CHOICE_REGISTRY = {
          style: { workflowStage: 'script_intake', offerBuilder: true, parseDecision: true },
        } satisfies Record<EditFirstChoiceType, EditFirstChoiceDefinition>
      `,
      workflowCheckpoints: "const renamedPolicy = { style: 'script_intake' }",
      assistantRenderers: `
        const selectedType = card.choiceType
        switch (selectedType) {}
      `,
    })
    expect(violations).toContain('Workflow Lab restores a private Choice-to-stage map outside EDIT_FIRST_CHOICE_REGISTRY')
    expect(violations.some((violation) => violation.includes('type-specific control semantics'))).toBe(true)
  })

  it('rejects computed Prisma delegates and raw SQL projection writes', () => {
    expect(inspectProjectAgentProjectionWrites(
      'fixture.ts',
      "await tx['projectAgentRun'].update({ where: { id }, data: { status: 'failed' } })",
    )).toContain('fixture.ts:1 (projectAgentRun.update)')
    expect(inspectProjectAgentProjectionWrites(
      'fixture.ts',
      "await tx.$executeRawUnsafe('UPDATE project_agent_runs SET status = ?', 'failed')",
    )).toContain('fixture.ts: raw SQL mutates an Assistant lifecycle projection table')
  })
})
