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

export async function readSecurityProjectCharacter(input: {
  readonly characterId: string
  readonly projectId: string
}): Promise<{
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly sourceGlobalCharacterId: string | null
  readonly profileConfirmed: boolean
  readonly appearanceDescription: string | null
} | null> {
  const row = await queryOne(
    `SELECT c.id, c.projectId, c.name, c.sourceGlobalCharacterId, c.profileConfirmed,
            a.description AS appearanceDescription
     FROM project_characters c
     LEFT JOIN character_appearances a
       ON a.characterId = c.id AND a.appearanceIndex = 0
     WHERE c.id = ? AND c.projectId = ?
     LIMIT 1`,
    [input.characterId, input.projectId],
  )
  if (!row || typeof row.id !== 'string' || typeof row.projectId !== 'string' || typeof row.name !== 'string') {
    return null
  }
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    sourceGlobalCharacterId: typeof row.sourceGlobalCharacterId === 'string'
      ? row.sourceGlobalCharacterId
      : null,
    profileConfirmed: row.profileConfirmed === true
      || row.profileConfirmed === 1
      || row.profileConfirmed === '1',
    appearanceDescription: typeof row.appearanceDescription === 'string'
      ? row.appearanceDescription
      : null,
  }
}
