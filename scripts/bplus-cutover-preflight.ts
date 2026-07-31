import { PrismaClient } from '@prisma/client'

type QueryRow = Record<string, unknown>

interface BlockerQuery {
  readonly code: string
  readonly countSql: string
  readonly sampleSql: string
}

const REQUIRED_LEGACY_TABLES = [
  'user',
  'tasks',
  'operation_executions',
  'approval_grants',
  'creative_resources',
  'project_assistant_threads',
  'project_agent_runs',
  'project_agent_waits',
  'project_agent_activities',
  'project_agent_interruptions',
  'project_agent_execution_handoffs',
  'project_agent_continuation_checkpoints',
  'project_agent_events',
  'outbox_commands',
] as const

const FORBIDDEN_PARTIAL_CUTOVER_TABLES = [
  'project_agent_turns',
  'agent_tool_effects',
  'agent_turn_interactions',
  'follow_up_batches',
  'follow_up_batch_members',
] as const

const REQUIRED_LEGACY_COLUMNS = {
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

const FORBIDDEN_PARTIAL_CUTOVER_COLUMNS = {
  operation_executions: [
    'executionKind',
    'commandId',
    'payloadHash',
    'contractRevision',
    'normalizedInput',
    'contextSnapshot',
    'source',
  ],
} as const

const ARCHIVE_COLUMNS = [
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

interface CharacterColumnDefinition {
  readonly columnType: string
  readonly characterSetName: string
  readonly collationName: string
  readonly isNullable: 'YES' | 'NO'
}

const PROPOSED_ARCHIVE_USER_ID_DEFINITION: CharacterColumnDefinition = {
  columnType: 'varchar(191)',
  characterSetName: 'utf8mb4',
  collationName: 'utf8mb4_unicode_ci',
  isNullable: 'NO',
}

const BLOCKER_QUERIES: readonly BlockerQuery[] = [
  {
    code: 'NON_TERMINAL_TASK',
    countSql: `
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE status NOT IN ('completed', 'failed', 'canceled', 'dismissed')
    `,
    sampleSql: `
      SELECT id, status, type, userId, projectId, updatedAt
      FROM tasks
      WHERE status NOT IN ('completed', 'failed', 'canceled', 'dismissed')
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'NON_TERMINAL_AGENT_RUN',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_agent_runs
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
    `,
    sampleSql: `
      SELECT id, status, projectId, userId, updatedAt
      FROM project_agent_runs
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'NON_TERMINAL_AGENT_WAIT',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_agent_waits
      WHERE status NOT IN ('followed', 'abandoned')
    `,
    sampleSql: `
      SELECT id, status, runId, operationId, updatedAt
      FROM project_agent_waits
      WHERE status NOT IN ('followed', 'abandoned')
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'NON_TERMINAL_AGENT_ACTIVITY',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_agent_activities
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
    `,
    sampleSql: `
      SELECT id, status, runId, operationId, updatedAt
      FROM project_agent_activities
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'PENDING_AGENT_INTERRUPTION',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_agent_interruptions
      WHERE status NOT IN ('consumed', 'superseded')
    `,
    sampleSql: `
      SELECT id, status, runId, operationId, updatedAt
      FROM project_agent_interruptions
      WHERE status NOT IN ('consumed', 'superseded')
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'PREPARED_EXECUTION_HANDOFF',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_agent_execution_handoffs
      WHERE status <> 'settled'
    `,
    sampleSql: `
      SELECT id, status, runId, operationId, updatedAt
      FROM project_agent_execution_handoffs
      WHERE status <> 'settled'
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'RUNNING_CONTINUATION_CHECKPOINT',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_agent_continuation_checkpoints
      WHERE status <> 'settled'
    `,
    sampleSql: `
      SELECT commandId, status, runId, waitId, startedAt
      FROM project_agent_continuation_checkpoints
      WHERE status <> 'settled'
      ORDER BY startedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'UNDELIVERED_OUTBOX_COMMAND',
    countSql: `
      SELECT COUNT(*) AS count
      FROM outbox_commands
      WHERE acceptedAt IS NULL AND deadAt IS NULL
    `,
    sampleSql: `
      SELECT id, kind, aggregateType, aggregateId, deliveryCount, availableAt
      FROM outbox_commands
      WHERE acceptedAt IS NULL AND deadAt IS NULL
      ORDER BY availableAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'INCOMPLETE_OPERATION_EXECUTION',
    countSql: `
      SELECT COUNT(*) AS count
      FROM operation_executions
      WHERE status <> 'completed'
    `,
    sampleSql: `
      SELECT id, status, operationId, userId, projectId, updatedAt
      FROM operation_executions
      WHERE status <> 'completed'
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'UNCONSUMED_APPROVAL_GRANT',
    countSql: `
      SELECT COUNT(*) AS count
      FROM approval_grants
      WHERE consumedAt IS NULL AND revokedAt IS NULL
    `,
    sampleSql: `
      SELECT id, operationId, userId, projectId, issuedAt
      FROM approval_grants
      WHERE consumedAt IS NULL AND revokedAt IS NULL
      ORDER BY issuedAt ASC
      LIMIT 20
    `,
  },
  {
    code: 'PENDING_MODEL_HISTORY_CHECKPOINT',
    countSql: `
      SELECT COUNT(*) AS count
      FROM project_assistant_threads
      WHERE pendingModelHistoryJson IS NOT NULL
         OR pendingModelHistorySegmentId IS NOT NULL
         OR pendingModelHistoryBaseVersion IS NOT NULL
         OR pendingModelHistoryReady = TRUE
    `,
    sampleSql: `
      SELECT id, projectId, userId, pendingModelHistorySegmentId,
             pendingModelHistoryBaseVersion, pendingModelHistoryReady
      FROM project_assistant_threads
      WHERE pendingModelHistoryJson IS NOT NULL
         OR pendingModelHistorySegmentId IS NOT NULL
         OR pendingModelHistoryBaseVersion IS NOT NULL
         OR pendingModelHistoryReady = TRUE
      ORDER BY updatedAt ASC
      LIMIT 20
    `,
  },
] as const

function normalizeCount(value: unknown): number {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  throw new Error(`BPLUS_PREFLIGHT_COUNT_INVALID:${String(value)}`)
}

function stringifyForLog(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, field) => typeof field === 'bigint' ? field.toString() : field,
  )
}

function normalizeVersion(value: unknown): readonly [number, number, number] {
  if (typeof value !== 'string') {
    throw new Error('BPLUS_PREFLIGHT_MYSQL_VERSION_INVALID')
  }
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new Error(`BPLUS_PREFLIGHT_MYSQL_VERSION_INVALID:${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function supportsRequiredMysqlVersion(
  version: readonly [number, number, number],
): boolean {
  const [major, minor, patch] = version
  return major > 8
    || (major === 8 && (minor > 0 || (minor === 0 && patch >= 17)))
}

async function queryRows(
  prisma: PrismaClient,
  sql: string,
): Promise<QueryRow[]> {
  return await prisma.$queryRawUnsafe<QueryRow[]>(sql)
}

async function readCount(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await queryRows(prisma, sql)
  return normalizeCount(rows[0]?.count)
}

async function tableExists(
  prisma: PrismaClient,
  tableName: string,
): Promise<boolean> {
  return await readCount(prisma, `
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = '${tableName}'
  `) === 1
}

async function columnExists(
  prisma: PrismaClient,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  return await readCount(prisma, `
    SELECT COUNT(*) AS count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = '${tableName}'
      AND column_name = '${columnName}'
  `) === 1
}

function requireStringField(
  row: QueryRow,
  field: string,
  errorCode: string,
): string {
  const value = row[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${errorCode}:${field}`)
  }
  return value
}

async function readCharacterColumnDefinition(
  prisma: PrismaClient,
  tableName: string,
  columnName: string,
): Promise<CharacterColumnDefinition> {
  const rows = await queryRows(prisma, `
    SELECT
      COLUMN_TYPE AS columnType,
      CHARACTER_SET_NAME AS characterSetName,
      COLLATION_NAME AS collationName,
      IS_NULLABLE AS isNullable
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = '${tableName}'
      AND column_name = '${columnName}'
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) {
    throw new Error(
      `BPLUS_PREFLIGHT_CHARACTER_COLUMN_MISSING:${tableName}.${columnName}`,
    )
  }
  const isNullable = requireStringField(
    row,
    'isNullable',
    'BPLUS_PREFLIGHT_CHARACTER_COLUMN_INVALID',
  )
  if (isNullable !== 'YES' && isNullable !== 'NO') {
    throw new Error(
      `BPLUS_PREFLIGHT_CHARACTER_COLUMN_INVALID:${tableName}.${columnName}:isNullable`,
    )
  }
  return {
    columnType: requireStringField(
      row,
      'columnType',
      'BPLUS_PREFLIGHT_CHARACTER_COLUMN_INVALID',
    ).toLowerCase(),
    characterSetName: requireStringField(
      row,
      'characterSetName',
      'BPLUS_PREFLIGHT_CHARACTER_COLUMN_INVALID',
    ).toLowerCase(),
    collationName: requireStringField(
      row,
      'collationName',
      'BPLUS_PREFLIGHT_CHARACTER_COLUMN_INVALID',
    ).toLowerCase(),
    isNullable,
  }
}

function assertArchiveUserIdForeignKeyCompatibility(input: {
  readonly archive: CharacterColumnDefinition
  readonly user: CharacterColumnDefinition
}): void {
  if (
    input.archive.columnType === input.user.columnType
    && input.archive.characterSetName === input.user.characterSetName
    && input.archive.collationName === input.user.collationName
    && input.archive.isNullable === 'NO'
    && input.user.isNullable === 'NO'
  ) {
    return
  }
  console.error(stringifyForLog({
    code: 'ARCHIVE_USER_ID_FK_INCOMPATIBLE',
    archive: input.archive,
    user: input.user,
  }))
  throw new Error('BPLUS_PREFLIGHT_ARCHIVE_USER_ID_FK_INCOMPATIBLE')
}

async function assertExpectedLegacyShape(prisma: PrismaClient): Promise<void> {
  const missingTables: string[] = []
  for (const tableName of REQUIRED_LEGACY_TABLES) {
    if (!(await tableExists(prisma, tableName))) missingTables.push(tableName)
  }
  if (missingTables.length > 0) {
    throw new Error(
      `BPLUS_PREFLIGHT_LEGACY_TABLES_MISSING:${missingTables.join(',')}`,
    )
  }

  const partialTables: string[] = []
  for (const tableName of FORBIDDEN_PARTIAL_CUTOVER_TABLES) {
    if (await tableExists(prisma, tableName)) partialTables.push(tableName)
  }
  if (partialTables.length > 0) {
    throw new Error(
      `BPLUS_PREFLIGHT_PARTIAL_CUTOVER_TABLES_PRESENT:${partialTables.join(',')}`,
    )
  }

  const missingColumns: string[] = []
  for (const [tableName, columns] of Object.entries(
    REQUIRED_LEGACY_COLUMNS,
  )) {
    for (const columnName of columns) {
      if (!(await columnExists(prisma, tableName, columnName))) {
        missingColumns.push(`${tableName}.${columnName}`)
      }
    }
  }
  if (missingColumns.length > 0) {
    throw new Error(
      `BPLUS_PREFLIGHT_LEGACY_COLUMNS_MISSING:${missingColumns.join(',')}`,
    )
  }

  const partialColumns: string[] = []
  for (const [tableName, columns] of Object.entries(
    FORBIDDEN_PARTIAL_CUTOVER_COLUMNS,
  )) {
    for (const columnName of columns) {
      if (await columnExists(prisma, tableName, columnName)) {
        partialColumns.push(`${tableName}.${columnName}`)
      }
    }
  }
  if (partialColumns.length > 0) {
    throw new Error(
      `BPLUS_PREFLIGHT_PARTIAL_CUTOVER_COLUMNS_PRESENT:${partialColumns.join(',')}`,
    )
  }
}

async function assertArchiveShape(prisma: PrismaClient): Promise<void> {
  const userIdDefinition = await readCharacterColumnDefinition(
    prisma,
    'user',
    'id',
  )
  if (!(await tableExists(prisma, 'project_assistant_thread_archives'))) {
    assertArchiveUserIdForeignKeyCompatibility({
      archive: PROPOSED_ARCHIVE_USER_ID_DEFINITION,
      user: userIdDefinition,
    })
    return
  }
  const missingColumns: string[] = []
  for (const columnName of ARCHIVE_COLUMNS) {
    if (
      !(await columnExists(
        prisma,
        'project_assistant_thread_archives',
        columnName,
      ))
    ) {
      missingColumns.push(columnName)
    }
  }
  if (missingColumns.length > 0) {
    throw new Error(
      `BPLUS_PREFLIGHT_ARCHIVE_COLUMNS_MISSING:${missingColumns.join(',')}`,
    )
  }
  assertArchiveUserIdForeignKeyCompatibility({
    archive: await readCharacterColumnDefinition(
      prisma,
      'project_assistant_thread_archives',
      'userId',
    ),
    user: userIdDefinition,
  })
  const duplicates = await queryRows(prisma, `
    SELECT threadId, COUNT(*) AS count
    FROM project_assistant_thread_archives
    GROUP BY threadId
    HAVING COUNT(*) > 1
    ORDER BY threadId ASC
    LIMIT 20
  `)
  if (duplicates.length > 0) {
    console.error(stringifyForLog({
      code: 'DUPLICATE_ARCHIVE_THREAD',
      samples: duplicates,
    }))
    throw new Error('BPLUS_PREFLIGHT_DUPLICATE_ARCHIVE_THREAD')
  }
  const orphanUsers = await queryRows(prisma, `
    SELECT archive.id, archive.threadId, archive.userId
    FROM project_assistant_thread_archives AS archive
    LEFT JOIN user AS owner
      ON owner.id = archive.userId
    WHERE owner.id IS NULL
    ORDER BY archive.id ASC
    LIMIT 20
  `)
  if (orphanUsers.length > 0) {
    console.error(stringifyForLog({
      code: 'ORPHAN_ARCHIVE_USER',
      samples: orphanUsers,
    }))
    throw new Error('BPLUS_PREFLIGHT_ORPHAN_ARCHIVE_USER')
  }
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('BPLUS_PREFLIGHT_DATABASE_URL_REQUIRED')
  }
  const prisma = new PrismaClient()
  try {
    const versionRows = await queryRows(prisma, 'SELECT VERSION() AS version')
    const version = normalizeVersion(versionRows[0]?.version)
    if (!supportsRequiredMysqlVersion(version)) {
      throw new Error(
        `BPLUS_PREFLIGHT_MYSQL_VERSION_UNSUPPORTED:${version.join('.')}`,
      )
    }
    await assertExpectedLegacyShape(prisma)
    await assertArchiveShape(prisma)

    let blockerTotal = 0
    for (const blocker of BLOCKER_QUERIES) {
      const count = await readCount(prisma, blocker.countSql)
      console.log(stringifyForLog({ code: blocker.code, count }))
      if (count === 0) continue
      blockerTotal += count
      console.error(stringifyForLog({
        code: blocker.code,
        count,
        samples: await queryRows(prisma, blocker.sampleSql),
      }))
    }
    if (blockerTotal > 0) {
      throw new Error(
        `BPLUS_PREFLIGHT_BLOCKED:${String(blockerTotal)}`,
      )
    }
    console.log(stringifyForLog({
      code: 'BPLUS_PREFLIGHT_READY',
      mysqlVersion: version.join('.'),
    }))
  } finally {
    await prisma.$disconnect()
  }
}

run().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error),
  )
  process.exitCode = 1
})
