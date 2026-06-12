import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

function readSource(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8')
}

describe('project agent Agents SDK runtime guard', () => {
  it('keeps AI SDK streamText out of the backend project-agent runtime', () => {
    const runtime = readSource('src/lib/project-agent/runtime.ts')

    expect(runtime).not.toContain('streamText')
    expect(runtime).toContain('@openai/agents')
    expect(runtime).toContain('run(agent, runInput')
  })

  it('keeps old AI SDK approval response protocol out of the backend', () => {
    const runtime = readSource('src/lib/project-agent/runtime.ts')
    const route = readSource('src/app/api/projects/[projectId]/assistant/chat/route.ts')

    expect(runtime).not.toContain('addToolApprovalResponse')
    expect(route).not.toContain('addToolApprovalResponse')
    expect(route).toContain('findLatestProjectAgentApprovalResponse')
  })
})
