import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const fixtures: string[] = []
const guardPath = join(process.cwd(), 'scripts/guards/task-target-states-no-polling-guard.mjs')
const hookPath = 'src/lib/query/hooks/useTaskTargetStateMap.ts'
const episodeCoverCardPath =
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard.tsx'

const validHook = `
  export function useTaskTargetStateMap(projectId, targets, options = {}) {
    return useQuery({
      ...(options.activePollingInterval === undefined
        ? { refetchInterval: false }
        : { refetchInterval: () => options.activePollingInterval }),
    })
  }
`

const validEpisodeCoverCard = `
  useTaskTargetStateMap(projectId, targets, {
    activePollingInterval: 5_000,
  })
`

function writeFixtureFile(root: string, relativePath: string, content: string) {
  const fullPath = join(root, relativePath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
}

function createFixture(params: {
  hook?: string
  episodeCoverCard?: string
  extraSources?: Record<string, string>
}) {
  const root = mkdtempSync(join(tmpdir(), 'task-target-polling-guard-'))
  fixtures.push(root)
  mkdirSync(join(root, 'scripts/guards'), { recursive: true })
  copyFileSync(guardPath, join(root, 'scripts/guards/task-target-states-no-polling-guard.mjs'))
  writeFixtureFile(root, hookPath, params.hook ?? validHook)
  writeFixtureFile(root, episodeCoverCardPath, params.episodeCoverCard ?? validEpisodeCoverCard)
  writeFixtureFile(
    root,
    'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/VoiceStage.tsx',
    'export default function VoiceStage() { return null }',
  )
  writeFixtureFile(
    root,
    'src/lib/query/hooks/useSSE.ts',
    `
      const shouldInvalidateTargetStates =
        type === TASK_EVENT_TYPE.COMPLETED ||
        type === TASK_EVENT_TYPE.FAILED

      export { shouldInvalidateTargetStates }
    `,
  )
  for (const [relativePath, content] of Object.entries(params.extraSources ?? {})) {
    writeFixtureFile(root, relativePath, content)
  }
  return root
}

function runGuard(root: string) {
  return spawnSync(
    process.execPath,
    ['scripts/guards/task-target-states-no-polling-guard.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true })
  }
})

describe('task target polling guard', () => {
  it('accepts an undefined-to-false default with only the Episode cover opt-in', () => {
    const result = runGuard(createFixture({}))

    expect(result.status).toBe(0)
  })

  it('rejects an unrelated refetchInterval false literal that leaves polling enabled by default', () => {
    const result = runGuard(createFixture({
      hook: `
        const unrelated = { refetchInterval: false }
        export function useTaskTargetStateMap(projectId, targets, options = {}) {
          return useQuery({
            refetchInterval: () => options.activePollingInterval,
          })
        }
      `,
    }))

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('activePollingInterval must default to disabled')
  })

  it('rejects active polling opt-ins outside EpisodeCoverCard', () => {
    const result = runGuard(createFixture({
      extraSources: {
        'src/lib/query/hooks/useOtherConsumer.ts': `
          useTaskTargetStateMap(projectId, targets, {
            activePollingInterval: 5_000,
          })
        `,
      },
    }))

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Only EpisodeCoverCard may opt in to active task-target polling')
  })

  it('requires EpisodeCoverCard to keep the single active polling opt-in', () => {
    const result = runGuard(createFixture({
      episodeCoverCard: 'useTaskTargetStateMap(projectId, targets)',
    }))

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('EpisodeCoverCard must opt in exactly once')
  })
})
