import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import mysql, {
  type Connection,
  type ExecuteValues,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise'
import {
  serializeAssistantRuntimeMessage,
  type SerializedAssistantRuntimeMessage,
} from '@/lib/assistant-runtime/message-serialization'

const CUTOVER_ID = 'assistant-message-normalization-v1'
const CUTOVER_LOCK = 'wao:assistant-message-normalization-v1'
const LEDGER_TABLE = '_wao_assistant_message_cutover'
const ACTIVE_TABLE = 'project_assistant_threads'
const ARCHIVE_TABLE = 'project_assistant_thread_archives'
const ACTIVE_MESSAGE_TABLE = 'project_assistant_messages'
const ARCHIVE_MESSAGE_TABLE = 'project_assistant_message_archives'
const LEGACY_COLUMN = 'messagesJson'

type CutoverMode = 'guard' | 'preflight' | 'apply' | 'verify'
type CutoverPhase =
  | 'CLAIMED'
  | 'ADDITIVE_READY'
  | 'BACKFILL_VERIFIED'
  | 'ACTIVE_LEGACY_DROPPED'
  | 'ARCHIVE_LEGACY_DROPPED'

const CUTOVER_PHASE_ORDER: Readonly<Record<CutoverPhase, number>> = {
  CLAIMED: 0,
  ADDITIVE_READY: 1,
  BACKFILL_VERIFIED: 2,
  ACTIVE_LEGACY_DROPPED: 3,
  ARCHIVE_LEGACY_DROPPED: 4,
}

type BooleanRow = RowDataPacket & { readonly found: number }
type CountRow = RowDataPacket & { readonly rowCount: number }
type LockRow = RowDataPacket & { readonly acquired: number | null }
type ColumnRow = RowDataPacket & {
  readonly dataType: string
  readonly nullable: 'YES' | 'NO'
}
type LegacyRow = RowDataPacket & {
  readonly ownerId: string
  readonly messagesJson: unknown
  readonly createdAt: Date
  readonly updatedAt: Date
}
type StoredMessageRow = RowDataPacket & {
  readonly ownerId: string
  readonly messageId: string
  readonly position: number
  readonly messageJson: unknown
  readonly byteLength: number | null
  readonly revision: number
  readonly createdAt: Date
  readonly updatedAt: Date
}
type StoredMessagePositionRow = RowDataPacket & {
  readonly ownerId: string
  readonly messageId: string
  readonly position: number
}
type StoredMessageMetadataRow = StoredMessagePositionRow & { readonly byteLength: number | null }
type LedgerRow = RowDataPacket & {
  readonly phase: CutoverPhase
  readonly activeFingerprint: string
  readonly archiveFingerprint: string
  readonly activeCount: number
  readonly archiveCount: number
}

type SchemaState = {
  readonly activeTable: boolean
  readonly archiveTable: boolean
  readonly activeLegacy: boolean
  readonly archiveLegacy: boolean
  readonly nextMessagePosition: boolean
  readonly activeMessages: boolean
  readonly archiveMessages: boolean
  readonly activeByteLength: ColumnRow | null
  readonly archiveByteLength: ColumnRow | null
  readonly ledger: boolean
}

type PlannedMessage = {
  readonly ownerId: string
  readonly position: number
  readonly serialized: SerializedAssistantRuntimeMessage
  readonly createdAt: Date
  readonly updatedAt: Date
}

type SourcePlan = {
  readonly active: readonly PlannedMessage[]
  readonly archive: readonly PlannedMessage[]
  readonly activeFingerprint: string
  readonly archiveFingerprint: string
}

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) throw new Error('ASSISTANT_MESSAGE_CUTOVER_DATABASE_URL_REQUIRED')
  const url = new URL(value)
  if (url.protocol !== 'mysql:') throw new Error('ASSISTANT_MESSAGE_CUTOVER_MYSQL_REQUIRED')
  if (!url.pathname || url.pathname === '/') throw new Error('ASSISTANT_MESSAGE_CUTOVER_DATABASE_REQUIRED')
  return url.toString()
}

function requireMode(value: string | undefined): CutoverMode {
  if (value === 'guard' || value === 'preflight' || value === 'apply' || value === 'verify') return value
  throw new Error('ASSISTANT_MESSAGE_CUTOVER_MODE_INVALID')
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error('ASSISTANT_MESSAGE_CUTOVER_IDENTIFIER_INVALID')
  return `\`${value}\``
}

async function queryRows<Row extends RowDataPacket>(
  connection: Connection,
  sql: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  const [rows] = await connection.query<Row[]>(sql, [...values])
  return rows
}

async function execute(
  connection: Connection,
  sql: string,
  values: ExecuteValues[] = [],
): Promise<ResultSetHeader> {
  const [result] = await connection.execute<ResultSetHeader>(sql, values)
  return result
}

async function tableExists(connection: Connection, tableName: string): Promise<boolean> {
  const rows = await queryRows<BooleanRow>(connection, `
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
    ) AS found
  `, [tableName])
  return Number(rows[0]?.found) === 1
}

async function columnMetadata(
  connection: Connection,
  tableName: string,
  columnName: string,
): Promise<ColumnRow | null> {
  const rows = await queryRows<ColumnRow>(connection, `
    SELECT DATA_TYPE AS dataType, IS_NULLABLE AS nullable
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
  `, [tableName, columnName])
  return rows[0] ?? null
}

async function readSchemaState(connection: Connection): Promise<SchemaState> {
  const [activeTable, archiveTable, activeMessages, archiveMessages, ledger] = await Promise.all([
    tableExists(connection, ACTIVE_TABLE),
    tableExists(connection, ARCHIVE_TABLE),
    tableExists(connection, ACTIVE_MESSAGE_TABLE),
    tableExists(connection, ARCHIVE_MESSAGE_TABLE),
    tableExists(connection, LEDGER_TABLE),
  ])
  const [activeLegacy, archiveLegacy, nextMessagePosition, activeByteLength, archiveByteLength] = await Promise.all([
    activeTable ? columnMetadata(connection, ACTIVE_TABLE, LEGACY_COLUMN) : null,
    archiveTable ? columnMetadata(connection, ARCHIVE_TABLE, LEGACY_COLUMN) : null,
    activeTable ? columnMetadata(connection, ACTIVE_TABLE, 'nextMessagePosition') : null,
    activeMessages ? columnMetadata(connection, ACTIVE_MESSAGE_TABLE, 'byteLength') : null,
    archiveMessages ? columnMetadata(connection, ARCHIVE_MESSAGE_TABLE, 'byteLength') : null,
  ])
  return {
    activeTable,
    archiveTable,
    activeLegacy: activeLegacy !== null,
    archiveLegacy: archiveLegacy !== null,
    nextMessagePosition: nextMessagePosition !== null,
    activeMessages,
    archiveMessages,
    activeByteLength,
    archiveByteLength,
    ledger,
  }
}

function isFresh(state: SchemaState): boolean {
  return !state.activeTable
    && !state.archiveTable
    && !state.activeMessages
    && !state.archiveMessages
    && !state.ledger
}

function hasNormalizedShape(state: SchemaState): boolean {
  return state.activeTable
    && state.archiveTable
    && !state.activeLegacy
    && !state.archiveLegacy
    && state.nextMessagePosition
    && state.activeMessages
    && state.archiveMessages
    && state.activeByteLength?.nullable === 'NO'
    && state.archiveByteLength?.nullable === 'NO'
}

function hasLegacySource(state: SchemaState): boolean {
  return state.activeTable && state.archiveTable && state.activeLegacy && state.archiveLegacy
}

function parseJsonColumn(value: unknown): unknown {
  if (typeof value === 'string') return JSON.parse(value) as unknown
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8')) as unknown
  return value
}

function addFramed(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.byteLength)
  hash.update(length)
  hash.update(bytes)
}

function fingerprint(messages: readonly PlannedMessage[]): string {
  const hash = createHash('sha256')
  addFramed(hash, CUTOVER_ID)
  addFramed(hash, String(messages.length))
  for (const message of messages) {
    addFramed(hash, message.ownerId)
    addFramed(hash, String(message.position))
    addFramed(hash, message.serialized.serialized)
    addFramed(hash, message.createdAt.toISOString())
    addFramed(hash, message.updatedAt.toISOString())
  }
  return hash.digest('hex')
}

async function readLegacyMessages(
  connection: Connection,
  kind: 'active' | 'archive',
): Promise<readonly PlannedMessage[]> {
  const tableName = kind === 'active' ? ACTIVE_TABLE : ARCHIVE_TABLE
  const createdColumn = kind === 'active' ? 'createdAt' : 'threadCreatedAt'
  const updatedColumn = kind === 'active' ? 'updatedAt' : 'threadUpdatedAt'
  const rows = await queryRows<LegacyRow>(connection, `
    SELECT id AS ownerId, messagesJson, ${createdColumn} AS createdAt, ${updatedColumn} AS updatedAt
    FROM ${quoteIdentifier(tableName)}
    ORDER BY id ASC
  `)
  const planned: PlannedMessage[] = []
  for (const row of rows) {
    const rawMessages = parseJsonColumn(row.messagesJson)
    if (!Array.isArray(rawMessages)) {
      throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_TRANSCRIPT_INVALID`)
    }
    const ids = new Set<string>()
    for (let index = 0; index < rawMessages.length; index += 1) {
      const rawMessage = rawMessages[index]
      const serialized = await serializeAssistantRuntimeMessage(rawMessage)
      if (!isDeepStrictEqual(serialized.json, rawMessage)) {
        throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_MESSAGE_NOT_CANONICAL`)
      }
      if (ids.has(serialized.message.id)) {
        throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_MESSAGE_ID_DUPLICATE`)
      }
      ids.add(serialized.message.id)
      planned.push({
        ownerId: row.ownerId,
        position: index + 1,
        serialized,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    }
  }
  return planned
}

async function buildSourcePlan(connection: Connection): Promise<SourcePlan> {
  const [active, archive] = await Promise.all([
    readLegacyMessages(connection, 'active'),
    readLegacyMessages(connection, 'archive'),
  ])
  return {
    active,
    archive,
    activeFingerprint: fingerprint(active),
    archiveFingerprint: fingerprint(archive),
  }
}

async function requireNoActiveTurns(connection: Connection): Promise<void> {
  if (!(await tableExists(connection, 'project_agent_turns'))) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_TURN_TABLE_MISSING')
  }
  const rows = await queryRows<CountRow>(connection, `
    SELECT COUNT(*) AS rowCount
    FROM project_agent_turns
    WHERE status IN ('queued', 'running', 'waiting_approval')
  `)
  if (Number(rows[0]?.rowCount) !== 0) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_ACTIVE_TURNS_PRESENT')
  }
}

async function createLedgerTable(connection: Connection): Promise<void> {
  await execute(connection, `
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(LEDGER_TABLE)} (
      cutoverId VARCHAR(64) NOT NULL PRIMARY KEY,
      phase VARCHAR(32) NOT NULL,
      activeFingerprint CHAR(64) NOT NULL,
      archiveFingerprint CHAR(64) NOT NULL,
      activeCount INTEGER NOT NULL,
      archiveCount INTEGER NOT NULL,
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `)
}

async function readLedger(connection: Connection): Promise<LedgerRow | null> {
  if (!(await tableExists(connection, LEDGER_TABLE))) return null
  const rows = await queryRows<LedgerRow>(connection, `
    SELECT phase, activeFingerprint, archiveFingerprint, activeCount, archiveCount
    FROM ${quoteIdentifier(LEDGER_TABLE)}
    WHERE cutoverId = ?
  `, [CUTOVER_ID])
  if (rows.length > 1) throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_CONFLICT')
  const ledger = rows[0]
  if (!ledger) return null
  if (!Object.prototype.hasOwnProperty.call(CUTOVER_PHASE_ORDER, ledger.phase)) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_PHASE_INVALID')
  }
  if (
    !/^[a-f0-9]{64}$/.test(ledger.activeFingerprint)
    || !/^[a-f0-9]{64}$/.test(ledger.archiveFingerprint)
    || !Number.isSafeInteger(Number(ledger.activeCount))
    || Number(ledger.activeCount) < 0
    || !Number.isSafeInteger(Number(ledger.archiveCount))
    || Number(ledger.archiveCount) < 0
  ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_INVALID')
  return ledger
}

async function claimCutover(connection: Connection, plan: SourcePlan): Promise<LedgerRow> {
  await createLedgerTable(connection)
  await execute(connection, `
    INSERT INTO ${quoteIdentifier(LEDGER_TABLE)} (
      cutoverId, phase, activeFingerprint, archiveFingerprint, activeCount, archiveCount
    ) VALUES (?, 'CLAIMED', ?, ?, ?, ?)
  `, [
    CUTOVER_ID,
    plan.activeFingerprint,
    plan.archiveFingerprint,
    plan.active.length,
    plan.archive.length,
  ])
  const ledger = await readLedger(connection)
  if (!ledger) throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_MISSING')
  return ledger
}

async function updatePhase(connection: Connection, phase: CutoverPhase): Promise<void> {
  const result = await execute(connection, `
    UPDATE ${quoteIdentifier(LEDGER_TABLE)} SET phase = ? WHERE cutoverId = ?
  `, [phase, CUTOVER_ID])
  if (result.affectedRows !== 1) throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_MISSING')
}

async function advancePhase(
  connection: Connection,
  current: CutoverPhase,
  target: CutoverPhase,
): Promise<CutoverPhase> {
  if (CUTOVER_PHASE_ORDER[current] >= CUTOVER_PHASE_ORDER[target]) return current
  await updatePhase(connection, target)
  return target
}

function assertPlanMatchesLedger(plan: SourcePlan, ledger: LedgerRow): void {
  if (
    plan.activeFingerprint !== ledger.activeFingerprint
    || plan.archiveFingerprint !== ledger.archiveFingerprint
    || plan.active.length !== Number(ledger.activeCount)
    || plan.archive.length !== Number(ledger.archiveCount)
  ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_SOURCE_CHANGED')
}

async function ensureAdditiveSchema(connection: Connection): Promise<void> {
  let state = await readSchemaState(connection)
  if (!state.nextMessagePosition) {
    await execute(connection, `
      ALTER TABLE project_assistant_threads
      ADD COLUMN nextMessagePosition INTEGER NOT NULL DEFAULT 1
    `)
  }
  if (!state.activeMessages) {
    await execute(connection, `
      CREATE TABLE project_assistant_messages (
        threadId VARCHAR(191) NOT NULL,
        messageId VARCHAR(191) NOT NULL,
        position INTEGER NOT NULL,
        messageJson JSON NOT NULL,
        byteLength INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE INDEX project_assistant_messages_threadId_position_key (threadId, position),
        INDEX project_assistant_messages_threadId_updatedAt_idx (threadId, updatedAt),
        PRIMARY KEY (threadId, messageId),
        CONSTRAINT project_assistant_messages_threadId_fkey
          FOREIGN KEY (threadId) REFERENCES project_assistant_threads (id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `)
  }
  if (!state.archiveMessages) {
    await execute(connection, `
      CREATE TABLE project_assistant_message_archives (
        archiveId VARCHAR(191) NOT NULL,
        messageId VARCHAR(191) NOT NULL,
        position INTEGER NOT NULL,
        messageJson JSON NOT NULL,
        byteLength INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        UNIQUE INDEX project_assistant_message_archives_archiveId_position_key (archiveId, position),
        PRIMARY KEY (archiveId, messageId),
        CONSTRAINT project_assistant_message_archives_archiveId_fkey
          FOREIGN KEY (archiveId) REFERENCES project_assistant_thread_archives (id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `)
  }
  state = await readSchemaState(connection)
  if (state.activeMessages && !state.activeByteLength) {
    await execute(connection, `ALTER TABLE project_assistant_messages ADD COLUMN byteLength INTEGER NULL AFTER messageJson`)
  }
  if (state.archiveMessages && !state.archiveByteLength) {
    await execute(connection, `ALTER TABLE project_assistant_message_archives ADD COLUMN byteLength INTEGER NULL AFTER messageJson`)
  }
  state = await readSchemaState(connection)
  if (
    !state.nextMessagePosition
    || !state.activeMessages
    || !state.archiveMessages
    || !state.activeByteLength
    || !state.archiveByteLength
  ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_ADDITIVE_SCHEMA_DIVERGED')
}

async function readStoredMessage(
  connection: Connection,
  kind: 'active' | 'archive',
  ownerId: string,
  messageId: string,
): Promise<StoredMessageRow | null> {
  const tableName = kind === 'active' ? ACTIVE_MESSAGE_TABLE : ARCHIVE_MESSAGE_TABLE
  const ownerColumn = kind === 'active' ? 'threadId' : 'archiveId'
  const rows = await queryRows<StoredMessageRow>(connection, `
    SELECT ${ownerColumn} AS ownerId, messageId, position, messageJson, byteLength,
      revision, createdAt, updatedAt
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(ownerColumn)} = ? AND messageId = ?
  `, [ownerId, messageId])
  return rows[0] ?? null
}

async function serializeCanonicalStoredMessage(
  kind: 'active' | 'archive',
  rawMessage: unknown,
  expectedMessageId: string,
): Promise<SerializedAssistantRuntimeMessage> {
  const parsed = parseJsonColumn(rawMessage)
  const serialized = await serializeAssistantRuntimeMessage(parsed)
  if (!isDeepStrictEqual(serialized.json, parsed)) {
    throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_MESSAGE_NOT_CANONICAL`)
  }
  if (serialized.message.id !== expectedMessageId) {
    throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_MESSAGE_ID_DIVERGED`)
  }
  return serialized
}

function sameTime(left: Date, right: Date): boolean {
  return new Date(left).getTime() === new Date(right).getTime()
}

function assertStoredMessage(
  kind: 'active' | 'archive',
  stored: StoredMessageRow,
  planned: PlannedMessage,
): void {
  if (
    stored.ownerId !== planned.ownerId
    || stored.messageId !== planned.serialized.message.id
    || Number(stored.position) !== planned.position
    || !isDeepStrictEqual(parseJsonColumn(stored.messageJson), planned.serialized.json)
    || Number(stored.byteLength) !== planned.serialized.byteLength
    || Number(stored.revision) !== 0
    || !sameTime(stored.createdAt, planned.createdAt)
    || !sameTime(stored.updatedAt, planned.updatedAt)
  ) throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_TARGET_CONFLICT`)
}

async function insertOrVerifyMessage(
  connection: Connection,
  kind: 'active' | 'archive',
  planned: PlannedMessage,
): Promise<void> {
  const existing = await readStoredMessage(
    connection,
    kind,
    planned.ownerId,
    planned.serialized.message.id,
  )
  if (existing) {
    assertStoredMessage(kind, existing, planned)
    return
  }
  if (kind === 'active') {
    await execute(connection, `
      INSERT INTO project_assistant_messages (
        threadId, messageId, position, messageJson, byteLength, revision, createdAt, updatedAt
      ) VALUES (?, ?, ?, CAST(? AS JSON), ?, 0, ?, ?)
    `, [
      planned.ownerId,
      planned.serialized.message.id,
      planned.position,
      planned.serialized.serialized,
      planned.serialized.byteLength,
      planned.createdAt,
      planned.updatedAt,
    ])
    return
  }
  await execute(connection, `
    INSERT INTO project_assistant_message_archives (
      archiveId, messageId, position, messageJson, byteLength, revision, createdAt, updatedAt
    ) VALUES (?, ?, ?, CAST(? AS JSON), ?, 0, ?, ?)
  `, [
    planned.ownerId,
    planned.serialized.message.id,
    planned.position,
    planned.serialized.serialized,
    planned.serialized.byteLength,
    planned.createdAt,
    planned.updatedAt,
  ])
}

async function backfillLegacyPlan(connection: Connection, plan: SourcePlan): Promise<void> {
  for (const message of plan.active) await insertOrVerifyMessage(connection, 'active', message)
  for (const message of plan.archive) await insertOrVerifyMessage(connection, 'archive', message)

  const activeByOwner = new Map<string, number>()
  for (const message of plan.active) {
    activeByOwner.set(message.ownerId, Math.max(activeByOwner.get(message.ownerId) ?? 0, message.position))
  }
  const legacyThreads = await queryRows<(RowDataPacket & { readonly id: string; readonly nextMessagePosition: number })>(
    connection,
    'SELECT id, nextMessagePosition FROM project_assistant_threads ORDER BY id ASC',
  )
  for (const thread of legacyThreads) {
    const expected = (activeByOwner.get(thread.id) ?? 0) + 1
    const current = Number(thread.nextMessagePosition)
    if (current !== 1 && current !== expected) {
      throw new Error('ASSISTANT_MESSAGE_CUTOVER_NEXT_POSITION_CONFLICT')
    }
    if (current !== expected) {
      await execute(
        connection,
        'UPDATE project_assistant_threads SET nextMessagePosition = ? WHERE id = ?',
        [expected, thread.id],
      )
    }
  }
}

async function verifyLegacyPlan(connection: Connection, plan: SourcePlan): Promise<void> {
  const [activeCount, archiveCount] = await Promise.all([
    queryRows<CountRow>(connection, 'SELECT COUNT(*) AS rowCount FROM project_assistant_messages'),
    queryRows<CountRow>(connection, 'SELECT COUNT(*) AS rowCount FROM project_assistant_message_archives'),
  ])
  if (
    Number(activeCount[0]?.rowCount) !== plan.active.length
    || Number(archiveCount[0]?.rowCount) !== plan.archive.length
  ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_TARGET_COUNT_DIVERGED')
  for (const message of plan.active) {
    const stored = await readStoredMessage(connection, 'active', message.ownerId, message.serialized.message.id)
    if (!stored) throw new Error('ASSISTANT_MESSAGE_CUTOVER_ACTIVE_TARGET_MISSING')
    assertStoredMessage('active', stored, message)
  }
  for (const message of plan.archive) {
    const stored = await readStoredMessage(connection, 'archive', message.ownerId, message.serialized.message.id)
    if (!stored) throw new Error('ASSISTANT_MESSAGE_CUTOVER_ARCHIVE_TARGET_MISSING')
    assertStoredMessage('archive', stored, message)
  }
}

async function backfillExistingByteLengths(connection: Connection, kind: 'active' | 'archive'): Promise<void> {
  const tableName = kind === 'active' ? ACTIVE_MESSAGE_TABLE : ARCHIVE_MESSAGE_TABLE
  const ownerColumn = kind === 'active' ? 'threadId' : 'archiveId'
  const rows = await queryRows<StoredMessageMetadataRow>(connection, `
    SELECT ${ownerColumn} AS ownerId, messageId, position, byteLength
    FROM ${quoteIdentifier(tableName)}
    ORDER BY ${quoteIdentifier(ownerColumn)} ASC, position ASC
  `)
  for (const row of rows) {
    const stored = await readStoredMessage(connection, kind, row.ownerId, row.messageId)
    if (!stored) throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_TARGET_MISSING`)
    const serialized = await serializeCanonicalStoredMessage(
      kind,
      stored.messageJson,
      row.messageId,
    )
    if (row.byteLength !== null && Number(row.byteLength) !== serialized.byteLength) {
      throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_BYTE_LENGTH_DIVERGED`)
    }
    if (row.byteLength === null) {
      await execute(connection, `
        UPDATE ${quoteIdentifier(tableName)} SET byteLength = ?
        WHERE ${quoteIdentifier(ownerColumn)} = ? AND messageId = ?
      `, [serialized.byteLength, row.ownerId, row.messageId])
    }
  }
}

async function validateExistingMessagesBeforeByteLength(
  connection: Connection,
  kind: 'active' | 'archive',
): Promise<void> {
  const tableName = kind === 'active' ? ACTIVE_MESSAGE_TABLE : ARCHIVE_MESSAGE_TABLE
  const ownerColumn = kind === 'active' ? 'threadId' : 'archiveId'
  const rows = await queryRows<StoredMessagePositionRow>(connection, `
    SELECT ${ownerColumn} AS ownerId, messageId, position
    FROM ${quoteIdentifier(tableName)}
    ORDER BY ${quoteIdentifier(ownerColumn)} ASC, position ASC
  `)
  let priorOwnerId: string | null = null
  let expectedPosition = 1
  for (const row of rows) {
    if (row.ownerId !== priorOwnerId) {
      priorOwnerId = row.ownerId
      expectedPosition = 1
    }
    if (Number(row.position) !== expectedPosition) {
      throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_POSITION_DIVERGED`)
    }
    expectedPosition += 1
    const messageRows = await queryRows<RowDataPacket & { readonly messageJson: unknown }>(connection, `
      SELECT messageJson
      FROM ${quoteIdentifier(tableName)}
      WHERE ${quoteIdentifier(ownerColumn)} = ? AND messageId = ?
    `, [row.ownerId, row.messageId])
    const messageRow = messageRows[0]
    if (!messageRow) {
      throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_TARGET_MISSING`)
    }
    await serializeCanonicalStoredMessage(kind, messageRow.messageJson, row.messageId)
  }
}

async function readNormalizedMessages(
  connection: Connection,
  kind: 'active' | 'archive',
): Promise<readonly PlannedMessage[]> {
  const tableName = kind === 'active' ? ACTIVE_MESSAGE_TABLE : ARCHIVE_MESSAGE_TABLE
  const ownerColumn = kind === 'active' ? 'threadId' : 'archiveId'
  const rows = await queryRows<StoredMessageMetadataRow>(connection, `
    SELECT ${ownerColumn} AS ownerId, messageId, position, byteLength
    FROM ${quoteIdentifier(tableName)}
    ORDER BY ${quoteIdentifier(ownerColumn)} ASC, position ASC
  `)
  const planned: PlannedMessage[] = []
  for (const row of rows) {
    const stored = await readStoredMessage(connection, kind, row.ownerId, row.messageId)
    if (!stored) throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_TARGET_MISSING`)
    const serialized = await serializeCanonicalStoredMessage(
      kind,
      stored.messageJson,
      row.messageId,
    )
    if (Number(stored.byteLength) !== serialized.byteLength) {
      throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_BYTE_LENGTH_DIVERGED`)
    }
    if (Number(stored.revision) !== 0) {
      throw new Error(`ASSISTANT_MESSAGE_CUTOVER_${kind.toUpperCase()}_REVISION_DIVERGED`)
    }
    planned.push({
      ownerId: row.ownerId,
      position: Number(row.position),
      serialized,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    })
  }
  return planned
}

async function buildNormalizedPlan(connection: Connection): Promise<SourcePlan> {
  const [active, archive] = await Promise.all([
    readNormalizedMessages(connection, 'active'),
    readNormalizedMessages(connection, 'archive'),
  ])
  return {
    active,
    archive,
    activeFingerprint: fingerprint(active),
    archiveFingerprint: fingerprint(archive),
  }
}

function assertNormalizedPlanMatchesLedger(plan: SourcePlan, ledger: LedgerRow): void {
  if (
    plan.active.length !== Number(ledger.activeCount)
    || plan.archive.length !== Number(ledger.archiveCount)
  ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_TARGET_COUNT_DIVERGED')
  if (
    plan.activeFingerprint !== ledger.activeFingerprint
    || plan.archiveFingerprint !== ledger.archiveFingerprint
  ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_TARGET_FINGERPRINT_DIVERGED')
}

async function requireByteLengthsNotNull(connection: Connection): Promise<void> {
  for (const tableName of [ACTIVE_MESSAGE_TABLE, ARCHIVE_MESSAGE_TABLE]) {
    const rows = await queryRows<CountRow>(connection, `
      SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(tableName)} WHERE byteLength IS NULL
    `)
    if (Number(rows[0]?.rowCount) !== 0) {
      throw new Error('ASSISTANT_MESSAGE_CUTOVER_BYTE_LENGTH_NULL')
    }
  }
  const state = await readSchemaState(connection)
  if (state.activeByteLength?.nullable === 'YES') {
    await execute(connection, 'ALTER TABLE project_assistant_messages MODIFY byteLength INTEGER NOT NULL')
  }
  if (state.archiveByteLength?.nullable === 'YES') {
    await execute(connection, 'ALTER TABLE project_assistant_message_archives MODIFY byteLength INTEGER NOT NULL')
  }
}

async function verifyNormalizedData(connection: Connection): Promise<void> {
  const state = await readSchemaState(connection)
  if (!hasNormalizedShape(state)) throw new Error('ASSISTANT_MESSAGE_CUTOVER_SCHEMA_NOT_NORMALIZED')
  await backfillExistingByteLengths(connection, 'active')
  await backfillExistingByteLengths(connection, 'archive')
  const divergentPositions = await queryRows<RowDataPacket & { readonly id: string }>(connection, `
    SELECT thread.id
    FROM project_assistant_threads AS thread
    LEFT JOIN (
      SELECT threadId, COUNT(*) AS messageCount, MIN(position) AS minPosition,
        COALESCE(MAX(position), 0) AS maxPosition
      FROM project_assistant_messages
      GROUP BY threadId
    ) AS messages ON messages.threadId = thread.id
    WHERE COALESCE(messages.messageCount, 0) <> COALESCE(messages.maxPosition, 0)
       OR (COALESCE(messages.messageCount, 0) > 0 AND messages.minPosition <> 1)
       OR thread.nextMessagePosition <> COALESCE(messages.maxPosition, 0) + 1
    LIMIT 1
  `)
  if (divergentPositions.length > 0) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_POSITION_DIVERGED')
  }
  const divergentArchivePositions = await queryRows<RowDataPacket & { readonly archiveId: string }>(
    connection,
    `
      SELECT archiveId
      FROM project_assistant_message_archives
      GROUP BY archiveId
      HAVING COUNT(*) <> MAX(position) OR MIN(position) <> 1
      LIMIT 1
    `,
  )
  if (divergentArchivePositions.length > 0) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_ARCHIVE_POSITION_DIVERGED')
  }
}

async function finalizeNormalizedLedgerCutover(connection: Connection): Promise<void> {
  let ledger = await readLedger(connection)
  if (!ledger) throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_MISSING')
  if (CUTOVER_PHASE_ORDER[ledger.phase] < CUTOVER_PHASE_ORDER.ACTIVE_LEGACY_DROPPED) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_PHASE_INCOMPATIBLE_WITH_SCHEMA')
  }
  await advancePhase(connection, ledger.phase, 'ARCHIVE_LEGACY_DROPPED')
  ledger = await readLedger(connection)
  if (!ledger || ledger.phase !== 'ARCHIVE_LEGACY_DROPPED') {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_LEDGER_NOT_COMPLETE')
  }
  await verifyNormalizedData(connection)
  assertNormalizedPlanMatchesLedger(await buildNormalizedPlan(connection), ledger)
  await execute(connection, `DROP TABLE ${quoteIdentifier(LEDGER_TABLE)}`)
}

async function applyCutover(connection: Connection): Promise<Record<string, unknown>> {
  const initial = await readSchemaState(connection)
  if (isFresh(initial)) return { mode: 'apply', state: 'fresh', changed: false }
  if (hasNormalizedShape(initial)) {
    if (initial.ledger) {
      await requireNoActiveTurns(connection)
      await finalizeNormalizedLedgerCutover(connection)
      return { mode: 'apply', state: 'normalized', changed: true }
    }
    await verifyNormalizedData(connection)
    return { mode: 'apply', state: 'normalized', changed: false }
  }

  await requireNoActiveTurns(connection)
  let ledger = await readLedger(connection)
  let plan: SourcePlan | null = null
  if (!ledger) {
    if (!hasLegacySource(initial)) {
      const normalizedWithoutBytes = initial.activeTable
        && initial.archiveTable
        && !initial.activeLegacy
        && !initial.archiveLegacy
        && initial.nextMessagePosition
        && initial.activeMessages
        && initial.archiveMessages
      if (!normalizedWithoutBytes) throw new Error('ASSISTANT_MESSAGE_CUTOVER_UNKNOWN_SCHEMA_STATE')
      await validateExistingMessagesBeforeByteLength(connection, 'active')
      await validateExistingMessagesBeforeByteLength(connection, 'archive')
      await ensureAdditiveSchema(connection)
      await backfillExistingByteLengths(connection, 'active')
      await backfillExistingByteLengths(connection, 'archive')
      await requireByteLengthsNotNull(connection)
      await verifyNormalizedData(connection)
      return { mode: 'apply', state: 'normalized-byte-length-added', changed: true }
    }
    if (
      initial.nextMessagePosition
      || initial.activeMessages
      || initial.archiveMessages
      || initial.activeByteLength
      || initial.archiveByteLength
    ) throw new Error('ASSISTANT_MESSAGE_CUTOVER_UNCLAIMED_PARTIAL_SCHEMA')
    plan = await buildSourcePlan(connection)
    ledger = await claimCutover(connection, plan)
  }

  if (initial.activeLegacy && initial.archiveLegacy) {
    plan ??= await buildSourcePlan(connection)
    assertPlanMatchesLedger(plan, ledger)
  } else if (ledger.phase === 'CLAIMED' || ledger.phase === 'ADDITIVE_READY') {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_SOURCE_DROPPED_BEFORE_VERIFICATION')
  }

  await ensureAdditiveSchema(connection)
  let phase = await advancePhase(connection, ledger.phase, 'ADDITIVE_READY')

  if (plan) {
    await backfillLegacyPlan(connection, plan)
    await verifyLegacyPlan(connection, plan)
    await backfillExistingByteLengths(connection, 'active')
    await backfillExistingByteLengths(connection, 'archive')
    await requireByteLengthsNotNull(connection)
    assertPlanMatchesLedger(await buildSourcePlan(connection), ledger)
    phase = await advancePhase(connection, phase, 'BACKFILL_VERIFIED')
  }

  let state = await readSchemaState(connection)
  if (state.activeLegacy) {
    await execute(connection, 'ALTER TABLE project_assistant_threads DROP COLUMN messagesJson')
  }
  await advancePhase(connection, phase, 'ACTIVE_LEGACY_DROPPED')
  state = await readSchemaState(connection)
  if (state.archiveLegacy) {
    await execute(connection, 'ALTER TABLE project_assistant_thread_archives DROP COLUMN messagesJson')
  }
  await finalizeNormalizedLedgerCutover(connection)
  return { mode: 'apply', state: 'normalized', changed: true }
}

async function preflight(connection: Connection): Promise<Record<string, unknown>> {
  const state = await readSchemaState(connection)
  if (isFresh(state)) return { mode: 'preflight', state: 'fresh' }
  if (hasNormalizedShape(state)) {
    await verifyNormalizedData(connection)
    return { mode: 'preflight', state: 'normalized' }
  }
  await requireNoActiveTurns(connection)
  if (hasLegacySource(state)) {
    const plan = await buildSourcePlan(connection)
    const ledger = await readLedger(connection)
    if (ledger) assertPlanMatchesLedger(plan, ledger)
    return {
      mode: 'preflight',
      state: ledger ? 'legacy-claimed' : 'legacy',
      activeMessages: plan.active.length,
      archivedMessages: plan.archive.length,
      activeFingerprint: plan.activeFingerprint,
      archiveFingerprint: plan.archiveFingerprint,
    }
  }
  const normalizedWithoutBytes = state.activeTable
    && state.archiveTable
    && !state.activeLegacy
    && !state.archiveLegacy
    && state.nextMessagePosition
    && state.activeMessages
    && state.archiveMessages
  if (normalizedWithoutBytes) {
    await validateExistingMessagesBeforeByteLength(connection, 'active')
    await validateExistingMessagesBeforeByteLength(connection, 'archive')
    return { mode: 'preflight', state: 'normalized-byte-length-required' }
  }
  throw new Error('ASSISTANT_MESSAGE_CUTOVER_UNKNOWN_SCHEMA_STATE')
}

async function guard(connection: Connection): Promise<Record<string, unknown>> {
  const state = await readSchemaState(connection)
  if (isFresh(state)) return { mode: 'guard', state: 'fresh' }
  if (state.ledger) throw new Error('ASSISTANT_MESSAGE_CUTOVER_REQUIRED_RUN_PREFLIGHT_AND_APPLY')
  if (hasNormalizedShape(state)) return { mode: 'guard', state: 'normalized' }
  throw new Error('ASSISTANT_MESSAGE_CUTOVER_REQUIRED_RUN_PREFLIGHT_AND_APPLY')
}

async function verify(connection: Connection): Promise<Record<string, unknown>> {
  await verifyNormalizedData(connection)
  return { mode: 'verify', state: 'normalized' }
}

async function withCutoverLock<T>(connection: Connection, action: () => Promise<T>): Promise<T> {
  const rows = await queryRows<LockRow>(connection, 'SELECT GET_LOCK(?, 0) AS acquired', [CUTOVER_LOCK])
  if (Number(rows[0]?.acquired) !== 1) throw new Error('ASSISTANT_MESSAGE_CUTOVER_ALREADY_RUNNING')
  try {
    return await action()
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [CUTOVER_LOCK]).catch(() => undefined)
  }
}

async function main(): Promise<void> {
  const mode = requireMode(process.argv[2])
  const connection = await mysql.createConnection(requireDatabaseUrl())
  try {
    const result = await withCutoverLock(connection, async () => {
      if (mode === 'guard') return await guard(connection)
      if (mode === 'preflight') return await preflight(connection)
      if (mode === 'apply') return await applyCutover(connection)
      return await verify(connection)
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    await connection.end()
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
