import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

type QueryRow = Record<string, unknown>

const BASE_MIGRATION = path.resolve(
  'prisma/migrations/20260731120000_agent_turn_temporal_tasks_cutover/migration.sql',
)
const ADDITIVE_MIGRATION = path.resolve(
  'prisma/migrations/20260731170000_remove_project_assistant_tool_selection/migration.sql',
)
const PRISMA_SCHEMA = path.resolve('prisma/schema.prisma')
const PRISMA_CLI = path.resolve('node_modules/prisma/build/index.js')

const TARGET_TABLES = [
  'project_agent_turns',
  'agent_tool_effects',
  'agent_turn_interactions',
  'follow_up_batches',
  'follow_up_batch_members',
] as const

const RETIRED_TABLES = [
  'project_agent_runs',
  'project_agent_waits',
  'project_agent_activities',
  'project_agent_interruptions',
  'project_agent_execution_handoffs',
  'project_agent_continuation_checkpoints',
  'project_agent_events',
  'outbox_commands',
] as const

const RETIRED_COLUMNS = {
  project_assistant_threads: [
    'pendingModelHistoryJson',
    'pendingModelHistorySegmentId',
    'pendingModelHistoryBaseVersion',
    'pendingModelHistoryReady',
  ],
  tasks: [
    'priority',
    'batchKey',
    'externalId',
    'heartbeatAt',
    'enqueuedAt',
    'enqueueAttempts',
    'lastEnqueueError',
  ],
  creative_resources: ['executionSegmentId'],
} as const

const REQUIRED_OPERATION_COLUMNS = [
  'executionKind',
  'commandId',
  'payloadHash',
  'contractRevision',
  'normalizedInput',
  'contextSnapshot',
  'source',
] as const

const REQUIRED_BASE_ARCHIVE_COLUMNS = [
  'id',
  'threadId',
  'projectId',
  'userId',
  'episodeId',
  'assistantId',
  'scopeRef',
  'messagesJson',
  'modelHistoryJson',
  'threadCreatedAt',
  'threadUpdatedAt',
  'archivedAt',
] as const

interface CutoverSnapshot {
  readonly targetTableCount: number
  readonly retiredTableCount: number
  readonly retiredColumnCount: number
  readonly operationColumnCount: number
  readonly baseArchiveColumnCount: number
  readonly archiveForeignKeyCount: number
  readonly clearRequestColumnValid: boolean
  readonly cancelledTurnIdsColumnValid: boolean
  readonly toolSelectionTableExists: boolean
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  throw new Error(`BPLUS_CUTOVER_COUNT_INVALID:${String(value)}`)
}

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ')
}

async function readCount(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<QueryRow[]>(sql)
  return normalizeCount(rows[0]?.count)
}

async function readSnapshot(): Promise<CutoverSnapshot> {
  const prisma = new PrismaClient()
  try {
    const retiredColumnPredicates = Object.entries(RETIRED_COLUMNS)
      .map(
        ([tableName, columns]) =>
          `(table_name = '${tableName}' AND column_name IN (${sqlList(columns)}))`,
      )
      .join(' OR ')
    const [
      targetTableCount,
      retiredTableCount,
      retiredColumnCount,
      operationColumnCount,
      baseArchiveColumnCount,
      archiveForeignKeyCount,
      clearRequestColumnCount,
      cancelledTurnIdsColumnCount,
      toolSelectionTableCount,
    ] = await Promise.all([
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (${sqlList(TARGET_TABLES)})
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (${sqlList(RETIRED_TABLES)})
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND (${retiredColumnPredicates})
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'operation_executions'
          AND column_name IN (${sqlList(REQUIRED_OPERATION_COLUMNS)})
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'project_assistant_thread_archives'
          AND column_name IN (${sqlList(REQUIRED_BASE_ARCHIVE_COLUMNS)})
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.table_constraints
        WHERE constraint_schema = DATABASE()
          AND table_name = 'project_assistant_thread_archives'
          AND constraint_name = 'project_assistant_thread_archives_userId_fkey'
          AND constraint_type = 'FOREIGN KEY'
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'project_assistant_thread_archives'
          AND column_name = 'clearRequestId'
          AND column_type = 'varchar(128)'
          AND is_nullable = 'YES'
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'project_assistant_thread_archives'
          AND column_name = 'cancelledTurnIds'
          AND data_type = 'json'
          AND is_nullable = 'YES'
      `,
      ),
      readCount(
        prisma,
        `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'project_assistant_tool_selections'
      `,
      ),
    ])
    return {
      targetTableCount,
      retiredTableCount,
      retiredColumnCount,
      operationColumnCount,
      baseArchiveColumnCount,
      archiveForeignKeyCount,
      clearRequestColumnValid: clearRequestColumnCount === 1,
      cancelledTurnIdsColumnValid: cancelledTurnIdsColumnCount === 1,
      toolSelectionTableExists: toolSelectionTableCount === 1,
    }
  } finally {
    await prisma.$disconnect()
  }
}

function isBaseCutoverComplete(snapshot: CutoverSnapshot): boolean {
  return (
    snapshot.targetTableCount === TARGET_TABLES.length &&
    snapshot.retiredTableCount === 0 &&
    snapshot.retiredColumnCount === 0 &&
    snapshot.operationColumnCount === REQUIRED_OPERATION_COLUMNS.length &&
    snapshot.baseArchiveColumnCount === REQUIRED_BASE_ARCHIVE_COLUMNS.length &&
    snapshot.archiveForeignKeyCount === 1
  )
}

function isFinalCutoverComplete(snapshot: CutoverSnapshot): boolean {
  return (
    isBaseCutoverComplete(snapshot) &&
    snapshot.clearRequestColumnValid &&
    snapshot.cancelledTurnIdsColumnValid &&
    !snapshot.toolSelectionTableExists
  )
}

function executeMigration(filePath: string): void {
  const result = spawnSync(
    process.execPath,
    [PRISMA_CLI, 'db', 'execute', '--file', filePath, '--schema', PRISMA_SCHEMA],
    {
      env: process.env,
      stdio: 'inherit',
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`BPLUS_CUTOVER_MIGRATION_FAILED:${path.basename(path.dirname(filePath))}`)
  }
}

function snapshotForLog(snapshot: CutoverSnapshot): string {
  return JSON.stringify(snapshot)
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('BPLUS_CUTOVER_DATABASE_URL_REQUIRED')
  }

  const initial = await readSnapshot()
  if (isFinalCutoverComplete(initial)) {
    console.log(JSON.stringify({ code: 'BPLUS_CUTOVER_ALREADY_COMPLETE' }))
    return
  }

  if (initial.targetTableCount === 0) {
    if (
      initial.operationColumnCount !== 0 ||
      initial.retiredTableCount !== RETIRED_TABLES.length ||
      initial.retiredColumnCount !== Object.values(RETIRED_COLUMNS).flat().length
    ) {
      throw new Error(`BPLUS_CUTOVER_PARTIAL_BASE_RESTORE_REQUIRED:${snapshotForLog(initial)}`)
    }
    console.log(JSON.stringify({ code: 'BPLUS_CUTOVER_APPLYING_IMMUTABLE_BASE' }))
    executeMigration(BASE_MIGRATION)
  } else if (!isBaseCutoverComplete(initial)) {
    throw new Error(`BPLUS_CUTOVER_PARTIAL_BASE_RESTORE_REQUIRED:${snapshotForLog(initial)}`)
  } else {
    console.log(JSON.stringify({ code: 'BPLUS_CUTOVER_BASE_ALREADY_COMPLETE' }))
  }

  const afterBase = await readSnapshot()
  if (!isBaseCutoverComplete(afterBase)) {
    throw new Error(`BPLUS_CUTOVER_BASE_VALIDATION_FAILED:${snapshotForLog(afterBase)}`)
  }

  console.log(JSON.stringify({ code: 'BPLUS_CUTOVER_APPLYING_ADDITIVE' }))
  executeMigration(ADDITIVE_MIGRATION)

  const final = await readSnapshot()
  if (!isFinalCutoverComplete(final)) {
    throw new Error(`BPLUS_CUTOVER_FINAL_VALIDATION_FAILED:${snapshotForLog(final)}`)
  }
  console.log(JSON.stringify({ code: 'BPLUS_CUTOVER_COMPLETE' }))
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  process.exitCode = 1
})
