import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { describe, expect, it } from 'vitest'

type MessageRow = RowDataPacket & {
  readonly threadId: string
  readonly messageId: string
  readonly position: number
  readonly byteLength: number
}

type ColumnRow = RowDataPacket & {
  readonly columnCount: number
}

type ArchivedMessageRow = RowDataPacket & {
  readonly archiveId: string
  readonly messageId: string
  readonly position: number
  readonly messageJson: unknown
  readonly byteLength: number
  readonly revision: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

function requireTestDatabaseUrl(): URL {
  const value = process.env.DATABASE_URL?.trim()
  if (!value) throw new Error('TEST_DATABASE_URL_REQUIRED')
  const url = new URL(value)
  if (!url.pathname.toLowerCase().includes('test')) {
    throw new Error('ASSISTANT_MESSAGE_CUTOVER_TEST_DATABASE_REQUIRED')
  }
  return url
}

function runCutover(databaseUrl: URL, mode: 'guard' | 'preflight' | 'apply' | 'verify') {
  return spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(process.cwd(), 'scripts', 'migrations', 'assistant-message-cutover.ts'),
      mode,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
      encoding: 'utf8',
      timeout: 30_000,
    },
  )
}

describe('Assistant message legacy cutover', () => {
  it('backfills exact messages and resumes idempotently through the unique cutover entry', async () => {
    const configuredUrl = requireTestDatabaseUrl()
    const databaseName = `waoowaoo_test_assistant_cutover_${randomUUID().replaceAll('-', '')}`
    const adminUrl = new URL(configuredUrl)
    adminUrl.pathname = '/'
    const targetUrl = new URL(configuredUrl)
    targetUrl.pathname = `/${databaseName}`
    const admin = await mysql.createConnection(adminUrl.toString())
    let target: mysql.Connection | null = null

    const firstMessage = {
      id: 'legacy-user-message',
      role: 'user',
      parts: [{ type: 'text', text: '保留这条旧消息' }],
    }
    const secondMessage = {
      id: 'legacy-assistant-message',
      role: 'assistant',
      parts: [{ type: 'text', text: 'legacy assistant reply' }],
    }

    try {
      await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      target = await mysql.createConnection(targetUrl.toString())
      await target.query(`
        CREATE TABLE project_assistant_threads (
          id VARCHAR(191) NOT NULL PRIMARY KEY,
          messagesJson JSON NOT NULL,
          createdAt DATETIME(3) NOT NULL,
          updatedAt DATETIME(3) NOT NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `)
      await target.query(`
        CREATE TABLE project_assistant_thread_archives (
          id VARCHAR(191) NOT NULL PRIMARY KEY,
          messagesJson JSON NOT NULL,
          threadCreatedAt DATETIME(3) NOT NULL,
          threadUpdatedAt DATETIME(3) NOT NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `)
      await target.query(`
        CREATE TABLE project_agent_turns (
          id VARCHAR(191) NOT NULL PRIMARY KEY,
          status VARCHAR(32) NOT NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `)
      await target.execute(
        `INSERT INTO project_assistant_threads (id, messagesJson, createdAt, updatedAt)
         VALUES (?, CAST(? AS JSON), NOW(3), NOW(3))`,
        ['legacy-thread', JSON.stringify([firstMessage, secondMessage])],
      )
      await target.execute(
        `INSERT INTO project_assistant_thread_archives
           (id, messagesJson, threadCreatedAt, threadUpdatedAt)
         VALUES (?, CAST(? AS JSON), NOW(3), NOW(3))`,
        ['legacy-archive', JSON.stringify([firstMessage])],
      )

      const oversizeMessage = {
        id: 'legacy-oversize-message',
        role: 'assistant',
        parts: [{ type: 'text', text: 'x'.repeat(1_100_000) }],
      }
      await target.execute(
        `INSERT INTO project_assistant_threads (id, messagesJson, createdAt, updatedAt)
         VALUES (?, CAST(? AS JSON), NOW(3), NOW(3))`,
        ['legacy-oversize-thread', JSON.stringify([oversizeMessage])],
      )
      const oversizePreflight = runCutover(targetUrl, 'preflight')
      expect(oversizePreflight.status).toBe(1)
      expect(oversizePreflight.stderr).toContain('ASSISTANT_RUNTIME_MESSAGE_TOO_LARGE')
      const [prematureTargets] = await target.query<ColumnRow[]>(`
        SELECT COUNT(*) AS columnCount
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('project_assistant_messages', 'project_assistant_message_archives')
      `)
      expect(Number(prematureTargets[0]?.columnCount)).toBe(0)
      await target.execute('DELETE FROM project_assistant_threads WHERE id = ?', ['legacy-oversize-thread'])

      const legacyGuard = runCutover(targetUrl, 'guard')
      expect(legacyGuard.status).toBe(1)
      expect(legacyGuard.stderr).toContain('ASSISTANT_MESSAGE_CUTOVER_REQUIRED_RUN_PREFLIGHT_AND_APPLY')

      await target.query(`
        CREATE TABLE _wao_assistant_message_cutover (
          cutoverId VARCHAR(64) NOT NULL PRIMARY KEY,
          phase VARCHAR(32) NOT NULL,
          activeFingerprint CHAR(64) NOT NULL,
          archiveFingerprint CHAR(64) NOT NULL,
          activeCount INTEGER NOT NULL,
          archiveCount INTEGER NOT NULL,
          updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `)
      await target.query(`
        CREATE TRIGGER interrupt_assistant_message_cutover
        BEFORE UPDATE ON _wao_assistant_message_cutover
        FOR EACH ROW
        BEGIN
          IF NEW.phase = 'ACTIVE_LEGACY_DROPPED' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TEST_CUTOVER_INTERRUPTED_AFTER_ACTIVE_DROP';
          END IF;
        END
      `)

      const firstApply = runCutover(targetUrl, 'apply')
      expect(firstApply.status).toBe(1)
      expect(firstApply.stderr).toContain('TEST_CUTOVER_INTERRUPTED_AFTER_ACTIVE_DROP')

      const [interruptedState] = await target.query<(RowDataPacket & {
        readonly phase: string
        readonly activeLegacy: number
        readonly archiveLegacy: number
      })[]>(`
        SELECT ledger.phase,
          EXISTS(
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'project_assistant_threads'
              AND column_name = 'messagesJson'
          ) AS activeLegacy,
          EXISTS(
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'project_assistant_thread_archives'
              AND column_name = 'messagesJson'
          ) AS archiveLegacy
        FROM _wao_assistant_message_cutover AS ledger
        WHERE ledger.cutoverId = 'assistant-message-normalization-v1'
      `)
      expect(interruptedState[0]).toMatchObject({
        phase: 'BACKFILL_VERIFIED',
        activeLegacy: 0,
        archiveLegacy: 1,
      })

      await target.query('DROP TRIGGER interrupt_assistant_message_cutover')
      const [archivedTargets] = await target.query<ArchivedMessageRow[]>(`
        SELECT archiveId, messageId, position, messageJson, byteLength, revision, createdAt, updatedAt
        FROM project_assistant_message_archives
      `)
      const archivedTarget = archivedTargets[0]
      if (!archivedTarget) throw new Error('TEST_ARCHIVED_TARGET_MISSING')
      await target.execute(
        'DELETE FROM project_assistant_message_archives WHERE archiveId = ? AND messageId = ?',
        [archivedTarget.archiveId, archivedTarget.messageId],
      )
      const missingTargetApply = runCutover(targetUrl, 'apply')
      expect(missingTargetApply.status).toBe(1)
      expect(missingTargetApply.stderr).toContain('ASSISTANT_MESSAGE_CUTOVER_TARGET_COUNT_DIVERGED')
      const interruptedGuard = runCutover(targetUrl, 'guard')
      expect(interruptedGuard.status).toBe(1)
      expect(interruptedGuard.stderr).toContain('ASSISTANT_MESSAGE_CUTOVER_REQUIRED_RUN_PREFLIGHT_AND_APPLY')
      await target.execute(`
        INSERT INTO project_assistant_message_archives (
          archiveId, messageId, position, messageJson, byteLength, revision, createdAt, updatedAt
        ) VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)
      `, [
        archivedTarget.archiveId,
        archivedTarget.messageId,
        archivedTarget.position,
        JSON.stringify(archivedTarget.messageJson),
        archivedTarget.byteLength,
        archivedTarget.revision,
        archivedTarget.createdAt,
        archivedTarget.updatedAt,
      ])
      const [ledgerFingerprints] = await target.query<(RowDataPacket & {
        readonly activeFingerprint: string
      })[]>(`
        SELECT activeFingerprint
        FROM _wao_assistant_message_cutover
        WHERE cutoverId = 'assistant-message-normalization-v1'
      `)
      const activeFingerprint = ledgerFingerprints[0]?.activeFingerprint
      if (!activeFingerprint) throw new Error('TEST_LEDGER_FINGERPRINT_MISSING')
      await target.execute(`
        UPDATE _wao_assistant_message_cutover
        SET activeFingerprint = REPEAT('0', 64)
        WHERE cutoverId = 'assistant-message-normalization-v1'
      `)
      const fingerprintMismatchApply = runCutover(targetUrl, 'apply')
      expect(fingerprintMismatchApply.status).toBe(1)
      expect(fingerprintMismatchApply.stderr)
        .toContain('ASSISTANT_MESSAGE_CUTOVER_TARGET_FINGERPRINT_DIVERGED')
      await target.execute(`
        UPDATE _wao_assistant_message_cutover
        SET activeFingerprint = ?
        WHERE cutoverId = 'assistant-message-normalization-v1'
      `, [activeFingerprint])
      const finalApply = runCutover(targetUrl, 'apply')
      expect({ status: finalApply.status, stderr: finalApply.stderr }).toEqual({ status: 0, stderr: '' })

      const [activeRows] = await target.query<MessageRow[]>(`
        SELECT threadId, messageId, position, byteLength
        FROM project_assistant_messages
        ORDER BY position ASC
      `)
      expect(activeRows.map((row) => ({
        threadId: row.threadId,
        messageId: row.messageId,
        position: row.position,
        byteLength: row.byteLength,
      }))).toEqual([
        {
          threadId: 'legacy-thread',
          messageId: firstMessage.id,
          position: 1,
          byteLength: Buffer.byteLength(JSON.stringify(firstMessage), 'utf8'),
        },
        {
          threadId: 'legacy-thread',
          messageId: secondMessage.id,
          position: 2,
          byteLength: Buffer.byteLength(JSON.stringify(secondMessage), 'utf8'),
        },
      ])

      const [legacyColumns] = await target.execute<ColumnRow[]>(`
        SELECT COUNT(*) AS columnCount
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name IN ('project_assistant_threads', 'project_assistant_thread_archives')
          AND column_name = 'messagesJson'
      `)
      expect(Number(legacyColumns[0]?.columnCount)).toBe(0)

      const idempotentApply = runCutover(targetUrl, 'apply')
      expect({ status: idempotentApply.status, stderr: idempotentApply.stderr }).toEqual({ status: 0, stderr: '' })
      const verify = runCutover(targetUrl, 'verify')
      expect({ status: verify.status, stderr: verify.stderr }).toEqual({ status: 0, stderr: '' })

      await target.execute(
        'UPDATE project_assistant_messages SET position = 0 WHERE messageId = ?',
        [firstMessage.id],
      )
      const gappedPositionVerify = runCutover(targetUrl, 'verify')
      expect(gappedPositionVerify.status).toBe(1)
      expect(gappedPositionVerify.stderr).toContain('ASSISTANT_MESSAGE_CUTOVER_POSITION_DIVERGED')
      await target.execute(
        'UPDATE project_assistant_messages SET position = 1 WHERE messageId = ?',
        [firstMessage.id],
      )

      await target.query('ALTER TABLE project_assistant_messages DROP COLUMN byteLength')
      await target.execute(
        'UPDATE project_assistant_messages SET messageJson = CAST(? AS JSON) WHERE messageId = ?',
        [JSON.stringify({ ...firstMessage, ignored: 'x'.repeat(1_100_000) }), firstMessage.id],
      )
      const nonCanonicalPreflight = runCutover(targetUrl, 'preflight')
      expect(nonCanonicalPreflight.status).toBe(1)
      expect(nonCanonicalPreflight.stderr).toContain('ASSISTANT_MESSAGE_CUTOVER_ACTIVE_MESSAGE_NOT_CANONICAL')
      await target.execute(
        'UPDATE project_assistant_messages SET messageJson = CAST(? AS JSON) WHERE messageId = ?',
        [JSON.stringify({ ...oversizeMessage, id: firstMessage.id }), firstMessage.id],
      )
      const normalizedWithoutBytesPreflight = runCutover(targetUrl, 'preflight')
      expect(normalizedWithoutBytesPreflight.status).toBe(1)
      expect(normalizedWithoutBytesPreflight.stderr).toContain('ASSISTANT_RUNTIME_MESSAGE_TOO_LARGE')
    } finally {
      await target?.end()
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``)
      await admin.end()
    }
  }, 60_000)
})
