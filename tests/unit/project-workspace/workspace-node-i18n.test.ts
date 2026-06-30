import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type JsonRecord = Record<string, unknown>

type ProjectWorkflowMessages = {
  readonly canvas?: {
    readonly workspace?: JsonRecord & {
      readonly nodeFields?: Record<string, string>
    }
  }
}

const REPO_ROOT = process.cwd()
const WORKSPACE_NODE_PATH = join(REPO_ROOT, 'src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
const WORKSPACE_NODE_CANVAS_PROJECTION_PATH = join(
  REPO_ROOT,
  'src/features/project-workspace/canvas/hooks/useWorkspaceNodeCanvasProjection.ts',
)

interface StaticMessageCall {
  readonly key: string
  readonly valueKeys: readonly string[]
}

function readProjectWorkflowMessages(locale: 'en' | 'zh'): ProjectWorkflowMessages {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, `messages/${locale}/project-workflow.json`), 'utf8'),
  ) as ProjectWorkflowMessages
}

function readWorkspaceNodeFieldKeys(): readonly string[] {
  const source = readFileSync(WORKSPACE_NODE_PATH, 'utf8')
  return Array.from(source.matchAll(/labels\('([^']+)'/g), (match) => match[1])
    .filter((key): key is string => typeof key === 'string')
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort()
}

function readWorkspaceProjectionTranslationKeys(): readonly string[] {
  const source = readFileSync(WORKSPACE_NODE_CANVAS_PROJECTION_PATH, 'utf8')
  return Array.from(source.matchAll(/translate\(\s*['"]([^'"]+)['"]/g), (match) => match[1])
    .filter((key): key is string => typeof key === 'string')
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort()
}

function readStaticMessageCalls(path: string, callee: 'labels' | 'translate'): readonly StaticMessageCall[] {
  const source = readFileSync(path, 'utf8')
  const callPattern = new RegExp(`${callee}\\(\\s*['"]([^'"]+)['"](?:\\s*,\\s*\\{([\\s\\S]*?)\\})?\\s*\\)`, 'g')
  return Array.from(source.matchAll(callPattern), (match) => ({
    key: match[1],
    valueKeys: Array.from((match[2] ?? '').matchAll(/([A-Za-z_$][\w$]*)\s*:/g), (valueMatch) => valueMatch[1])
      .filter((key, index, keys) => keys.indexOf(key) === index)
      .sort(),
  })).sort((left, right) => left.key.localeCompare(right.key))
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNestedMessageValue(messages: JsonRecord | undefined, key: string): unknown {
  let current: unknown = messages
  for (const segment of key.split('.')) {
    if (!isJsonRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function readMessagePlaceholders(value: unknown): readonly string[] {
  if (typeof value !== 'string') return []
  return Array.from(value.matchAll(/\{\s*([A-Za-z_]\w*)\s*\}/g), (match) => match[1])
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort()
}

describe('WorkspaceNode i18n messages', () => {
  it('defines every nodeFields key used by the workspace canvas node renderer', () => {
    const usedKeys = readWorkspaceNodeFieldKeys()

    for (const locale of ['en', 'zh'] as const) {
      const messages = readProjectWorkflowMessages(locale)
      const nodeFields = messages.canvas?.workspace?.nodeFields
      expect(nodeFields, `${locale} projectWorkflow.canvas.workspace.nodeFields`).toBeDefined()

      const missingKeys = usedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(nodeFields, key))
      expect(missingKeys, `${locale} missing WorkspaceNode nodeFields`).toEqual([])
    }
  })

  it('defines every workspace canvas key used by the projection builder', () => {
    const usedKeys = readWorkspaceProjectionTranslationKeys()

    for (const locale of ['en', 'zh'] as const) {
      const messages = readProjectWorkflowMessages(locale)
      const workspaceMessages = messages.canvas?.workspace
      expect(workspaceMessages, `${locale} projectWorkflow.canvas.workspace`).toBeDefined()

      const missingKeys = usedKeys.filter((key) => readNestedMessageValue(workspaceMessages, key) === undefined)
      expect(missingKeys, `${locale} missing workspace canvas projection messages`).toEqual([])
    }
  })

  it('passes every required placeholder for static workspace canvas message calls', () => {
    const callSets = [
      {
        calls: readStaticMessageCalls(WORKSPACE_NODE_CANVAS_PROJECTION_PATH, 'translate'),
        readMessage: (workspaceMessages: JsonRecord | undefined, key: string) => readNestedMessageValue(workspaceMessages, key),
      },
      {
        calls: readStaticMessageCalls(WORKSPACE_NODE_PATH, 'labels'),
        readMessage: (workspaceMessages: JsonRecord | undefined, key: string) => readNestedMessageValue(
          isJsonRecord(workspaceMessages?.nodeFields) ? workspaceMessages.nodeFields : undefined,
          key,
        ),
      },
    ] as const

    for (const locale of ['en', 'zh'] as const) {
      const messages = readProjectWorkflowMessages(locale)
      const workspaceMessages = messages.canvas?.workspace

      const missingPlaceholders = callSets.flatMap(({ calls, readMessage }) => calls.flatMap((call) => {
        const placeholders = readMessagePlaceholders(readMessage(workspaceMessages, call.key))
        return placeholders
          .filter((placeholder) => !call.valueKeys.includes(placeholder))
          .map((placeholder) => `${call.key}:${placeholder}`)
      }))

      expect(missingPlaceholders, `${locale} missing workspace canvas message placeholders`).toEqual([])
    }
  })
})
