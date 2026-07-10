import { describe, expect, it } from 'vitest'
import { inspectProjectAgentDirectTaskSubmit } from '../../../scripts/guards/no-project-agent-direct-task-submit.mjs'

describe('no project-agent direct task submission guard', () => {
  it('allows project-agent code to consume the operation registry', () => {
    const content = "import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'\n"

    expect(inspectProjectAgentDirectTaskSubmit('src/lib/project-agent/runtime.ts', content)).toEqual([])
  })

  it('rejects feature task submission imports from choice side effects', () => {
    const content = "import { submitProjectEditStylePreviewsGenerationTask } from '@/lib/edit-script/task-submission'\n"

    expect(inspectProjectAgentDirectTaskSubmit(
      'src/lib/project-agent/edit-first-choice-result.ts',
      content,
    )).toEqual([
      'src/lib/project-agent/edit-first-choice-result.ts imports a task submission entry; Assistant execution must use the operation registry so approval, runtime signals, and ProjectAgentWait stay bound',
    ])
  })

  it('rejects the generic task submitter from assistant routes', () => {
    const content = "import { submitTask } from '@/lib/task/submitter'\n"

    expect(inspectProjectAgentDirectTaskSubmit(
      'src/app/api/projects/[projectId]/assistant/chat/route.ts',
      content,
    )).toHaveLength(1)
  })
})
