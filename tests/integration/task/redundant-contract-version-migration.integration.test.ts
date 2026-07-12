import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import { describe, expect, it } from 'vitest'

const migrationPath = new URL(
  '../../../prisma/migrations/20260712233000_remove_redundant_contract_versions/migration.sql',
  import.meta.url,
)

interface JsonRow extends RowDataPacket {
  value: unknown
}

interface ColumnRow extends RowDataPacket {
  TABLE_NAME: string
  COLUMN_NAME: string
}

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

describe('redundant contract version migration', () => {
  it('removes only fixed markers while preserving business fields and real CAS versions', async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    const database = `waoowaoo_version_cleanup_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const connection = await mysql.createConnection({
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || '3306'),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
    })

    try {
      await connection.query(`CREATE DATABASE \`${database}\``)
      await connection.query(`USE \`${database}\``)
      await connection.query('CREATE TABLE `project_agent_interruptions` (`id` VARCHAR(191) PRIMARY KEY, `type` VARCHAR(32), `payload` JSON NOT NULL)')
      await connection.query('CREATE TABLE `location_images` (`id` VARCHAR(191) PRIMARY KEY, `spatialProfileJson` JSON NULL)')
      await connection.query('CREATE TABLE `global_location_images` (`id` VARCHAR(191) PRIMARY KEY, `spatialProfileJson` JSON NULL)')
      await connection.query('CREATE TABLE `project_edit_soundscapes` (`id` VARCHAR(191) PRIMARY KEY, `planJson` JSON NULL, `version` INT NOT NULL, `status` VARCHAR(32) NOT NULL)')
      await connection.query('CREATE TABLE `project_edit_music_scores` (`id` VARCHAR(191) PRIMARY KEY, `cuesJson` JSON NULL, `version` INT NOT NULL, `status` VARCHAR(32) NOT NULL)')
      await connection.query('CREATE TABLE `project_episode_source_documents` (`id` VARCHAR(191) PRIMARY KEY, `scriptStructureJson` JSON NULL)')
      await connection.query('CREATE TABLE `task_execution_checkpoints` (`id` VARCHAR(191) PRIMARY KEY, `stepKey` VARCHAR(191) NOT NULL, `output` JSON NOT NULL)')
      await connection.query('CREATE TABLE `outbox_commands` (`id` VARCHAR(191) PRIMARY KEY, `kind` VARCHAR(64) NOT NULL, `payload` JSON NOT NULL, `version` INT NOT NULL)')
      await connection.query('CREATE TABLE `operation_plan_snapshots` (`id` VARCHAR(191) PRIMARY KEY, `contractVersion` INT NOT NULL, `planHash` VARCHAR(64) NOT NULL)')
      await connection.query('CREATE TABLE `approval_grants` (`id` VARCHAR(191) PRIMARY KEY, `contractVersion` INT NOT NULL, `version` INT NOT NULL)')
      await connection.query('CREATE TABLE `operation_executions` (`id` VARCHAR(191) PRIMARY KEY, `contractVersion` INT NOT NULL, `status` VARCHAR(32) NOT NULL)')

      await connection.query(
        'INSERT INTO `project_agent_interruptions` VALUES (?, ?, ?)',
        ['choice', 'choice', JSON.stringify({ schemaVersion: 1, card: { cardId: 'card-1' }, reviewedResource: { fingerprint: 'abc' } })],
      )
      await connection.query('INSERT INTO `location_images` VALUES (?, ?)', ['location', JSON.stringify({ schemaVersion: 1, depth: 'near' })])
      await connection.query('INSERT INTO `global_location_images` VALUES (?, ?)', ['global-location', JSON.stringify({ schemaVersion: 1, depth: 'far' })])
      await connection.query('INSERT INTO `project_edit_soundscapes` VALUES (?, ?, ?, ?)', ['soundscape', JSON.stringify({ schemaVersion: 1, decision: 'soundscape' }), 1, 'completed'])
      await connection.query('INSERT INTO `project_edit_music_scores` VALUES (?, ?, ?, ?)', ['music', JSON.stringify({ schemaVersion: 2, finalPrompt: 'keep' }), 1, 'completed'])
      await connection.query('INSERT INTO `project_episode_source_documents` VALUES (?, ?)', ['source', JSON.stringify({ version: 1, title: 'Keep', segments: [] })])
      await connection.query('INSERT INTO `task_execution_checkpoints` VALUES (?, ?, ?), (?, ?, ?)', [
        'provider', 'provider:image:primary', JSON.stringify({ contractVersion: 1, state: 'submitted', result: { url: 'keep' } }),
        'other', 'artifact:stable', JSON.stringify({ contractVersion: 7, checksum: 'keep' }),
      ])
      await connection.query('INSERT INTO `outbox_commands` VALUES (?, ?, ?, ?)', ['outbox', 'task.enqueue', JSON.stringify({ kind: 'task.enqueue', version: 1, taskId: 'task-1' }), 1])
      await connection.query('INSERT INTO `operation_plan_snapshots` VALUES (?, ?, ?)', ['plan', 1, 'plan-hash'])
      await connection.query('INSERT INTO `approval_grants` VALUES (?, ?, ?)', ['grant', 1, 4])
      await connection.query('INSERT INTO `operation_executions` VALUES (?, ?, ?)', ['execution', 1, 'completed'])

      const statements = readFileSync(migrationPath, 'utf8')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
      for (const statement of statements) await connection.query(statement)

      const jsonQueries = [
        ['SELECT `payload` AS value FROM `project_agent_interruptions` WHERE `id` = ?', 'choice'],
        ['SELECT `spatialProfileJson` AS value FROM `location_images` WHERE `id` = ?', 'location'],
        ['SELECT `spatialProfileJson` AS value FROM `global_location_images` WHERE `id` = ?', 'global-location'],
        ['SELECT `planJson` AS value FROM `project_edit_soundscapes` WHERE `id` = ?', 'soundscape'],
        ['SELECT `cuesJson` AS value FROM `project_edit_music_scores` WHERE `id` = ?', 'music'],
        ['SELECT `scriptStructureJson` AS value FROM `project_episode_source_documents` WHERE `id` = ?', 'source'],
        ['SELECT `output` AS value FROM `task_execution_checkpoints` WHERE `id` = ?', 'provider'],
        ['SELECT `payload` AS value FROM `outbox_commands` WHERE `id` = ?', 'outbox'],
      ] as const
      const values: unknown[] = []
      for (const [sql, id] of jsonQueries) {
        const [rows] = await connection.query<JsonRow[]>(sql, [id])
        values.push(parseJson(rows[0]?.value))
      }
      expect(values).toEqual([
        { card: { cardId: 'card-1' }, reviewedResource: { fingerprint: 'abc' } },
        { depth: 'near' },
        { depth: 'far' },
        { decision: 'soundscape' },
        { finalPrompt: 'keep' },
        { title: 'Keep', segments: [] },
        { state: 'submitted', result: { url: 'keep' } },
        { kind: 'task.enqueue', taskId: 'task-1' },
      ])

      const [unrelatedRows] = await connection.query<JsonRow[]>(
        'SELECT `output` AS value FROM `task_execution_checkpoints` WHERE `id` = ?',
        ['other'],
      )
      expect(parseJson(unrelatedRows[0]?.value)).toEqual({ contractVersion: 7, checksum: 'keep' })

      const [columns] = await connection.query<ColumnRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND ((TABLE_NAME IN ('outbox_commands', 'project_edit_music_scores', 'project_edit_soundscapes') AND COLUMN_NAME = 'version')
             OR (TABLE_NAME IN ('operation_plan_snapshots', 'approval_grants', 'operation_executions') AND COLUMN_NAME = 'contractVersion'))`,
        [database],
      )
      expect(columns).toEqual([])

      const [grantRows] = await connection.query<RowDataPacket[]>('SELECT `version` FROM `approval_grants` WHERE `id` = ?', ['grant'])
      expect(grantRows).toEqual([{ version: 4 }])
      const [planRows] = await connection.query<RowDataPacket[]>('SELECT `planHash` FROM `operation_plan_snapshots` WHERE `id` = ?', ['plan'])
      expect(planRows).toEqual([{ planHash: 'plan-hash' }])
      const [executionRows] = await connection.query<RowDataPacket[]>('SELECT `status` FROM `operation_executions` WHERE `id` = ?', ['execution'])
      expect(executionRows).toEqual([{ status: 'completed' }])
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``)
      await connection.end()
    }
  })
})
