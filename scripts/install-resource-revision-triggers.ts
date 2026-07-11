import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

const migrationUrl = new URL(
  '../prisma/migrations/20260711060000_add_episode_resource_revision/migration.sql',
  import.meta.url,
)

export function parseResourceRevisionTriggerStatements(sql: string): readonly {
  readonly name: string
  readonly statement: string
}[] {
  return sql
    .split(';')
    .map((part) => part.slice(part.indexOf('CREATE TRIGGER')).trim())
    .filter((statement) => statement.startsWith('CREATE TRIGGER'))
    .map((statement) => {
      const name = statement.match(/^CREATE TRIGGER\s+`([^`]+)`/)?.[1]
      if (!name) throw new Error('RESOURCE_REVISION_TRIGGER_NAME_MISSING')
      return { name, statement }
    })
}

export async function installProjectEpisodeResourceRevisionTriggers(input?: {
  readonly databaseUrl?: string
}): Promise<{ readonly outcome: 'installed' | 'already_installed'; readonly count: number }> {
  const databaseUrl = input?.databaseUrl ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const parsedUrl = new URL(databaseUrl)
  const database = parsedUrl.pathname.slice(1)
  if (!database) throw new Error('DATABASE_NAME_REQUIRED')
  const migrationSql = await readFile(migrationUrl, 'utf8')
  const triggers = parseResourceRevisionTriggerStatements(migrationSql)
  if (triggers.length === 0) throw new Error('RESOURCE_REVISION_TRIGGERS_MISSING')

  const connection = await mysql.createConnection(databaseUrl)
  try {
    const names = triggers.map((trigger) => trigger.name)
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME IN (${names.map(() => '?').join(', ')})`,
      [database, ...names],
    )
    const existing = new Set(rows.map((row) => String(row.TRIGGER_NAME)))
    if (existing.size === triggers.length) {
      return { outcome: 'already_installed', count: existing.size }
    }
    if (existing.size !== 0) {
      throw new Error(`RESOURCE_REVISION_TRIGGER_SET_PARTIAL:${existing.size}:${triggers.length}`)
    }
    for (const trigger of triggers) {
      await connection.query(trigger.statement)
    }
    return { outcome: 'installed', count: triggers.length }
  } finally {
    await connection.end()
  }
}

async function main() {
  const result = await installProjectEpisodeResourceRevisionTriggers()
  process.stdout.write(
    `[resource-revision-triggers] ${result.outcome} count=${String(result.count)}\n`,
  )
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) {
  await main()
}
