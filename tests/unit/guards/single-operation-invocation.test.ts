import { describe, expect, it } from 'vitest'
import {
  inspectOperationAdapter,
  inspectOperationDomain,
} from '../../../scripts/guards/single-operation-invocation-guard.mjs'

describe('single operation invocation guard', () => {
  it('accepts a thin adapter that delegates with an explicit channel', () => {
    const content = [
      "import { invokeProjectAgentOperation } from '@/lib/operations/invocation'",
      "invokeProjectAgentOperation({ channel: 'api' })",
    ].join('\n')

    expect(inspectOperationAdapter('src/lib/adapters/api/example.ts', 'api', content)).toEqual([])
  })

  it('rejects an adapter that parses operation input itself', () => {
    const content = [
      "import { invokeProjectAgentOperation } from '@/lib/operations/invocation'",
      "operation.inputSchema.safeParse(input)",
      "invokeProjectAgentOperation({ channel: 'tool', executionFence: fence })",
    ].join('\n')

    expect(inspectOperationAdapter('src/lib/adapters/tools/example.ts', 'tool', content)).toHaveLength(1)
  })

  it('rejects an adapter that invokes an operation executor directly', () => {
    const content = [
      "import { invokeProjectAgentOperation } from '@/lib/operations/invocation'",
      "operation.execute(context, input)",
      "invokeProjectAgentOperation({ channel: 'tool', executionFence: fence })",
    ].join('\n')

    expect(inspectOperationAdapter('src/lib/adapters/tools/example.ts', 'tool', content)).toHaveLength(1)
  })

  it('rejects a tool adapter that drops the Assistant Run execution fence', () => {
    const content = [
      "import { invokeProjectAgentOperation } from '@/lib/operations/invocation'",
      "invokeProjectAgentOperation({ channel: 'tool' })",
    ].join('\n')

    expect(inspectOperationAdapter('src/lib/adapters/tools/example.ts', 'tool', content)).toEqual([
      'src/lib/adapters/tools/example.ts must pass the Assistant Run execution fence to the shared authority',
    ])
  })

  it('rejects an Operation implementation that calls an API route over HTTP', () => {
    const content = "await fetch('/api/projects/project-1/reference-to-character')"

    expect(inspectOperationDomain('src/lib/operations/domains/gui/example.ts', content)).toEqual([
      'src/lib/operations/domains/gui/example.ts must not invoke HTTP from an Operation implementation; call the registered Operation authority explicitly',
    ])
  })
})
