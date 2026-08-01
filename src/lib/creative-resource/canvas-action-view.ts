import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  CreativeResourceCanvasOperationView,
  CreativeResourceJsonObject,
  CreativeResourceStatus,
} from './contracts'

type CanvasActionReadClient = Pick<Prisma.TransactionClient, 'task'> | typeof prisma

interface CanvasActionResourceRecord {
  readonly id: string
  readonly status: CreativeResourceStatus
  readonly operationId: string | null
}

const REGENERATABLE_OPERATION_IDS = new Set([
  'create_image',
  'create_audio',
  'create_video',
  'generate_voice',
])

function readJsonRecord(value: Prisma.JsonValue | undefined, field: string): CreativeResourceJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`CREATIVE_RESOURCE_CANVAS_ACTION_INPUT_INVALID:${field}`)
  }
  return value as CreativeResourceJsonObject
}

function buildRegenerationInput(input: CreativeResourceJsonObject): {
  readonly input: CreativeResourceJsonObject
  readonly editableInputPath: readonly string[]
} | null {
  const request = readJsonRecord(input.request, 'request')
  if (request.kind === 'new') {
    if (typeof request.prompt !== 'string' || !request.prompt.trim()) return null
    return {
      input: { ...input, request: { ...request, count: 1 } },
      editableInputPath: ['request', 'prompt'],
    }
  }
  if (request.kind === 'single') {
    const target = readJsonRecord(request.target, 'request.target')
    if (
      target.kind !== 'standalone'
      || typeof request.description !== 'string'
      || !request.description.trim()
    ) {
      return null
    }
    return {
      input: { ...input, request: { ...request, count: 1 } },
      editableInputPath: ['request', 'description'],
    }
  }
  return null
}

/**
 * Projects exact retry/regeneration inputs from the immutable initial Plan.
 * The Canvas never rebuilds references, provider options, or scope itself.
 */
export async function loadCreativeResourceCanvasOperationViews(
  client: CanvasActionReadClient,
  rows: readonly CanvasActionResourceRecord[],
  userId: string,
): Promise<ReadonlyMap<string, readonly CreativeResourceCanvasOperationView[]>> {
  const eligibleRows = rows.filter((row) => (
    REGENERATABLE_OPERATION_IDS.has(row.operationId ?? '')
    && (row.status === 'ready' || row.status === 'failed')
  ))
  if (eligibleRows.length === 0) return new Map()

  const rowById = new Map(eligibleRows.map((row) => [row.id, row]))
  const tasks = await client.task.findMany({
    where: {
      userId,
      targetType: 'CreativeResource',
      targetId: { in: eligibleRows.map((row) => row.id) },
      operationId: { in: [...REGENERATABLE_OPERATION_IDS] },
    },
    select: {
      id: true,
      targetId: true,
      operationId: true,
      operationExecution: {
        select: {
          planSnapshot: { select: { normalizedInput: true } },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const rootsByResourceId = new Map<string, Array<{
    readonly operationId: string
    readonly regeneration: ReturnType<typeof buildRegenerationInput>
  }>>()
  for (const task of tasks) {
    const row = rowById.get(task.targetId)
    const normalizedInput = task.operationExecution?.planSnapshot?.normalizedInput
    if (!row || !normalizedInput || !task.operationId || task.operationId !== row.operationId) continue
    const input = readJsonRecord(normalizedInput, 'input')
    const request = readJsonRecord(input.request, 'request')
    if (request.kind === 'retry') continue
    const roots = rootsByResourceId.get(row.id) ?? []
    roots.push({
      operationId: task.operationId,
      regeneration: buildRegenerationInput(input),
    })
    rootsByResourceId.set(row.id, roots)
  }

  const result = new Map<string, readonly CreativeResourceCanvasOperationView[]>()
  for (const row of eligibleRows) {
    const roots = rootsByResourceId.get(row.id) ?? []
    if (roots.length > 1) {
      throw new Error(`CREATIVE_RESOURCE_CANVAS_ACTION_ROOT_AMBIGUOUS:${row.id}`)
    }
    const root = roots[0]
    const operations: CreativeResourceCanvasOperationView[] = []
    if (row.status === 'failed') {
      operations.push({
        kind: 'retry',
        operationId: row.operationId ?? '',
        confirmation: 'billable_media',
        input: { request: { kind: 'retry', resourceIds: [row.id] } },
        editableInputPath: null,
      })
    }
    if (root?.regeneration) {
      if (row.status === 'ready') {
        operations.push({
          kind: 'variant',
          operationId: root.operationId,
          confirmation: 'billable_media',
          input: root.regeneration.input,
          editableInputPath: null,
        })
      }
      operations.push({
        kind: 'edit_regenerate',
        operationId: root.operationId,
        confirmation: 'billable_media',
        input: root.regeneration.input,
        editableInputPath: root.regeneration.editableInputPath,
      })
    }
    result.set(row.id, operations)
  }
  return result
}
