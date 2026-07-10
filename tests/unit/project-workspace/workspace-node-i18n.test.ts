import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
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
const WORKSPACE_NODE_RENDERERS_PATH = join(
  REPO_ROOT,
  'src/features/project-workspace/canvas/nodes/WorkspaceNodeRenderers.tsx',
)
const WORKSPACE_NODE_CANVAS_PROJECTION_PATH = join(
  REPO_ROOT,
  'src/features/project-workspace/canvas/projection/workspace-node-canvas-projection.ts',
)

interface StaticMessageCall {
  readonly key: string
  readonly valueKeys: readonly string[]
}

interface StaticProjectWorkflowMessageCall extends StaticMessageCall {
  readonly namespace: string
  readonly sourcePath: string
}

function readProjectWorkflowMessages(locale: 'en' | 'zh'): ProjectWorkflowMessages {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, `messages/${locale}/project-workflow.json`), 'utf8'),
  ) as ProjectWorkflowMessages
}

function readSourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') return []
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) return readSourceFiles(entryPath)
    return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : []
  })
}

function readWorkspaceNodeFieldKeys(): readonly string[] {
  const source = [WORKSPACE_NODE_PATH, WORKSPACE_NODE_RENDERERS_PATH]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
  return Array.from(source.matchAll(/labels\('([^']+)'/g), (match) => match[1])
    .filter((key): key is string => typeof key === 'string')
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort()
}

function readStaticProjectWorkflowMessageCalls(): readonly StaticProjectWorkflowMessageCall[] {
  return readSourceFiles(join(REPO_ROOT, 'src')).flatMap((sourcePath) => {
    const source = readFileSync(sourcePath, 'utf8')
    const bindings = new Map<string, string>()
    for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\(\s*['"](projectWorkflow(?:\.[^'"]+)?)['"]\s*\)/g)) {
      bindings.set(match[1], match[2])
    }

    return Array.from(bindings.entries()).flatMap(([callee, namespace]) => {
      const callPattern = new RegExp(`\\b${callee}\\(\\s*['"]([^'"]+)['"](?:\\s*,\\s*\\{([\\s\\S]*?)\\})?\\s*\\)`, 'g')
      return Array.from(source.matchAll(callPattern), (match): StaticProjectWorkflowMessageCall => ({
        sourcePath,
        namespace,
        key: match[1],
        valueKeys: readStaticObjectKeys(match[2] ?? ''),
      }))
    })
  }).sort((left, right) => `${left.sourcePath}:${left.namespace}:${left.key}`.localeCompare(`${right.sourcePath}:${right.namespace}:${right.key}`))
}

function readWorkspaceProjectionTranslationKeys(): readonly string[] {
  const source = readFileSync(WORKSPACE_NODE_CANVAS_PROJECTION_PATH, 'utf8')
  const sourceFile = ts.createSourceFile(
    WORKSPACE_NODE_CANVAS_PROJECTION_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const keys: string[] = []

  const collectStringLiterals = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      keys.push(node.text)
      return
    }
    node.forEachChild(collectStringLiterals)
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'translate'
      && node.arguments[0]
    ) {
      collectStringLiterals(node.arguments[0])
    }
    node.forEachChild(visit)
  }

  visit(sourceFile)

  return keys
    .filter((key, index, allKeys) => allKeys.indexOf(key) === index)
    .sort()
}

function readStaticMessageCalls(path: string, callee: 'labels' | 'translate'): readonly StaticMessageCall[] {
  const source = readFileSync(path, 'utf8')
  const callPattern = new RegExp(`${callee}\\(\\s*['"]([^'"]+)['"](?:\\s*,\\s*\\{([\\s\\S]*?)\\})?\\s*\\)`, 'g')
  return Array.from(source.matchAll(callPattern), (match) => ({
    key: match[1],
    valueKeys: readStaticObjectKeys(match[2] ?? ''),
  })).sort((left, right) => left.key.localeCompare(right.key))
}

function readStaticObjectKeys(source: string): readonly string[] {
  return Array.from(source.matchAll(/([A-Za-z_$][\w$]*)\s*:/g), (match) => match[1])
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort()
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

function projectWorkflowNamespacePath(namespace: string, key: string): string {
  return `${namespace}.${key}`.replace(/^projectWorkflow\./, '')
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
    expect(usedKeys).toContain('nodes.editSourceScript.pendingTitle')
    expect(usedKeys).toContain('nodes.editSourceScript.pendingBody')

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
      {
        calls: readStaticMessageCalls(WORKSPACE_NODE_RENDERERS_PATH, 'labels'),
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

  it('defines every static projectWorkflow message and passes required placeholders', () => {
    const calls = readStaticProjectWorkflowMessageCalls()

    for (const locale of ['en', 'zh'] as const) {
      const messages = readProjectWorkflowMessages(locale) as JsonRecord

      const missingMessages = calls.flatMap((call) => {
        const messagePath = projectWorkflowNamespacePath(call.namespace, call.key)
        return readNestedMessageValue(messages, messagePath) === undefined
          ? [`${call.sourcePath}:${messagePath}`]
          : []
      })
      expect(missingMessages, `${locale} missing static projectWorkflow messages`).toEqual([])

      const missingPlaceholders = calls.flatMap((call) => {
        const messagePath = projectWorkflowNamespacePath(call.namespace, call.key)
        const placeholders = readMessagePlaceholders(readNestedMessageValue(messages, messagePath))
        return placeholders
          .filter((placeholder) => !call.valueKeys.includes(placeholder))
          .map((placeholder) => `${call.sourcePath}:${messagePath}:${placeholder}`)
      })
      expect(missingPlaceholders, `${locale} missing static projectWorkflow placeholders`).toEqual([])
    }
  })
})
