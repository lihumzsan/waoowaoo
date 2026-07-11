import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import { describe, expect, it } from 'vitest'

const migrationPath = new URL(
  '../../../prisma/migrations/20260711173000_remove_plan_run_persistence/migration.sql',
  import.meta.url,
)

interface TableRow extends RowDataPacket {
  TABLE_NAME: string
}

describe('PlanRun removal migration', () => {
  it('drops every retired PlanRun table in an isolated real MySQL schema', async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    const database = `waoowaoo_planrun_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    const connection = await mysql.createConnection({
      host: databaseUrl.hostname,
      port: Number(databaseUrl.port || '3306'),
      user: decodeURIComponent(databaseUrl.username),
      password: decodeURIComponent(databaseUrl.password),
    })
    try {
      await connection.query(`CREATE DATABASE \`${database}\``)
      await connection.query(`USE \`${database}\``)
      await connection.query('CREATE TABLE `plan_runs` (`id` VARCHAR(191) NOT NULL PRIMARY KEY)')
      await connection.query('CREATE TABLE `plan_step_runs` (`id` VARCHAR(191) NOT NULL PRIMARY KEY, `planRunId` VARCHAR(191), FOREIGN KEY (`planRunId`) REFERENCES `plan_runs`(`id`))')
      await connection.query('CREATE TABLE `plan_run_events` (`id` BIGINT NOT NULL PRIMARY KEY, `planRunId` VARCHAR(191), FOREIGN KEY (`planRunId`) REFERENCES `plan_runs`(`id`))')
      await connection.query('CREATE TABLE `plan_artifacts` (`id` VARCHAR(191) NOT NULL PRIMARY KEY, `planRunId` VARCHAR(191), FOREIGN KEY (`planRunId`) REFERENCES `plan_runs`(`id`))')
      const statements = readFileSync(migrationPath, 'utf8')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
      for (const statement of statements) await connection.query(statement)

      const [tables] = await connection.query<TableRow[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('plan_runs', 'plan_step_runs', 'plan_run_events', 'plan_artifacts')`,
        [database],
      )
      expect(tables).toEqual([])
    } finally {
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``)
      await connection.end()
    }
  })
})
