import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import { describe, expect, it } from 'vitest'

const migrationPath = new URL(
  '../../../prisma/migrations/20260711070000_add_edit_script_task_ownership/migration.sql',
  import.meta.url,
)

interface ColumnRow extends RowDataPacket {
  TABLE_NAME: string
  COLUMN_NAME: string
  IS_NULLABLE: string
}

interface IndexRow extends RowDataPacket {
  INDEX_NAME: string
}

describe('EditScript Task ownership migration', () => {
  it('adds both owner columns and indexes on a real MySQL schema', async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    const database = `waoowaoo_migration_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const connection = await mysql.createConnection({
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || '3306'),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
    })
    try {
      await connection.query(`CREATE DATABASE \`${database}\``)
      await connection.query(`USE \`${database}\``)
      await connection.query('CREATE TABLE `project_edit_scripts` (`id` VARCHAR(191) NOT NULL PRIMARY KEY)')
      await connection.query('CREATE TABLE `project_edit_shot_execution_plans` (`id` VARCHAR(191) NOT NULL PRIMARY KEY)')
      const statements = readFileSync(migrationPath, 'utf8')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
      for (const statement of statements) await connection.query(statement)

      const [columns] = await connection.query<ColumnRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'generationTaskId'
         ORDER BY TABLE_NAME`,
        [database],
      )
      expect(columns).toEqual([
        { TABLE_NAME: 'project_edit_scripts', COLUMN_NAME: 'generationTaskId', IS_NULLABLE: 'YES' },
        { TABLE_NAME: 'project_edit_shot_execution_plans', COLUMN_NAME: 'generationTaskId', IS_NULLABLE: 'YES' },
      ])

      const [indexes] = await connection.query<IndexRow[]>(
        `SELECT INDEX_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND INDEX_NAME IN (?, ?)
         ORDER BY INDEX_NAME`,
        [
          database,
          'project_edit_scripts_generationTaskId_idx',
          'project_edit_shot_execution_plans_generationTaskId_idx',
        ],
      )
      expect(indexes.map((index) => index.INDEX_NAME)).toEqual([
        'project_edit_scripts_generationTaskId_idx',
        'project_edit_shot_execution_plans_generationTaskId_idx',
      ])
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``)
      await connection.end()
    }
  })
})
