import { readFile } from 'node:fs/promises'
import path from 'node:path'
import mysql, { type RowDataPacket } from 'mysql2/promise'
import { resolveSecurityArtifactRoot } from '../runtime/identity'

async function resolveOracleDatabaseUrl(): Promise<string> {
  const explicit = process.env.SECURITY_ORACLE_DATABASE_URL?.trim()
  if (explicit) return explicit
  const descriptor = JSON.parse(await readFile(
    path.join(resolveSecurityArtifactRoot(), 'environment.json'),
    'utf8',
  )) as { readonly oracleDatabaseUrl?: unknown }
  if (typeof descriptor.oracleDatabaseUrl !== 'string' || !descriptor.oracleDatabaseUrl.trim()) {
    throw new Error('SECURITY_ORACLE_DATABASE_URL_MISSING')
  }
  return descriptor.oracleDatabaseUrl
}

async function queryOne(
  sql: string,
  parameters: readonly unknown[],
): Promise<RowDataPacket | null> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const [rows] = await connection.query<RowDataPacket[]>(sql, parameters)
    return rows[0] ?? null
  } finally {
    await connection.end()
  }
}

export async function readSecurityProjectById(projectId: string): Promise<{
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly description: string | null
} | null> {
  const row = await queryOne(
    'SELECT id, userId, name, description FROM projects WHERE id = ? LIMIT 1',
    [projectId],
  )
  if (!row || typeof row.id !== 'string' || typeof row.userId !== 'string' || typeof row.name !== 'string') {
    return null
  }
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: typeof row.description === 'string' ? row.description : null,
  }
}
