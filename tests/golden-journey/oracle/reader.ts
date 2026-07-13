import mysql, { type RowDataPacket } from 'mysql2/promise'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { GoldenWorkspaceScope } from '../browser/pages/home'
import { resolveGoldenArtifactRoot } from '../runtime/identity'
import type {
  GoldenOracleIdentitySummary,
  GoldenOracleSnapshot,
} from './types'

async function resolveOracleDatabaseUrl(): Promise<string> {
  const explicit = process.env.GOLDEN_ORACLE_DATABASE_URL?.trim()
  if (explicit) return explicit
  const descriptor = JSON.parse(await readFile(
    path.join(resolveGoldenArtifactRoot(), 'environment.json'),
    'utf8',
  )) as { readonly oracleDatabaseUrl?: unknown }
  if (typeof descriptor.oracleDatabaseUrl !== 'string' || !descriptor.oracleDatabaseUrl.trim()) {
    throw new Error('GOLDEN_ORACLE_DATABASE_URL_MISSING')
  }
  return descriptor.oracleDatabaseUrl
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
  }
  return value
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return normalize(value)
  try {
    return normalize(JSON.parse(value) as unknown)
  } catch {
    return value
  }
}

function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort()
}

function collectIdentities(threads: readonly Record<string, unknown>[]): GoldenOracleIdentitySummary {
  const messageIds: string[] = []
  const toolCallIds: string[] = []
  for (const thread of threads) {
    const messages = parseJson(thread.messagesJson)
    if (!Array.isArray(messages)) continue
    for (const message of messages) {
      const record = asRecord(message)
      if (!record) continue
      if (typeof record.id === 'string' && typeof record.role === 'string') messageIds.push(record.id)
      if (!Array.isArray(record.parts)) continue
      for (const part of record.parts) {
        const partRecord = asRecord(part)
        if (partRecord?.type === 'dynamic-tool' && typeof partRecord.toolCallId === 'string') {
          toolCallIds.push(partRecord.toolCallId)
        }
      }
    }
  }
  return {
    messageIds,
    duplicateMessageIds: duplicateValues(messageIds),
    toolCallIds,
    duplicateToolCallIds: duplicateValues(toolCallIds),
  }
}

async function queryRows(
  connection: mysql.Connection,
  sql: string,
  parameters: readonly unknown[],
): Promise<Record<string, unknown>[]> {
  const [rows] = await connection.query<RowDataPacket[]>(sql, parameters)
  return rows.map((row) => normalize(row) as Record<string, unknown>)
}

function compareOracleValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') {
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
    return left.localeCompare(right)
  }
  return String(left ?? '').localeCompare(String(right ?? ''))
}

function sortOracleRows(
  rows: readonly Record<string, unknown>[],
  ...keys: readonly string[]
): Record<string, unknown>[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareOracleValues(left[key], right[key])
      if (result !== 0) return result
    }
    return 0
  })
}

export async function assertGoldenOracleIsReadOnly(): Promise<void> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    await connection.query('CREATE TABLE golden_oracle_write_probe (id INT)')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
    if (code === 'ER_DBACCESS_DENIED_ERROR' || code === 'ER_TABLEACCESS_DENIED_ERROR') return
    throw error
  } finally {
    await connection.end()
  }
  throw new Error('GOLDEN_ORACLE_UNEXPECTEDLY_HAS_WRITE_ACCESS')
}

export async function readGoldenUserByName(name: string): Promise<{
  readonly id: string
  readonly name: string
} | null> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const rows = await queryRows(
      connection,
      'SELECT id, name FROM `user` WHERE name = ? LIMIT 1',
      [name],
    )
    const row = rows[0]
    return row && typeof row.id === 'string' && typeof row.name === 'string'
      ? { id: row.id, name: row.name }
      : null
  } finally {
    await connection.end()
  }
}

export async function readGoldenProjectById(projectId: string): Promise<{
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly description: string | null
} | null> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const rows = await queryRows(
      connection,
      'SELECT id, userId, name, description FROM projects WHERE id = ? LIMIT 1',
      [projectId],
    )
    const row = rows[0]
    if (!row || typeof row.id !== 'string' || typeof row.userId !== 'string' || typeof row.name !== 'string') {
      return null
    }
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      description: typeof row.description === 'string' ? row.description : null,
    }
  } finally {
    await connection.end()
  }
}

export async function readGoldenProjectsByOwnerAndName(input: {
  readonly userId: string
  readonly name: string
}): Promise<readonly { readonly id: string; readonly name: string }[]> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const rows = await queryRows(
      connection,
      'SELECT id, name FROM projects WHERE userId = ? AND name = ? ORDER BY createdAt',
      [input.userId, input.name],
    )
    return rows.flatMap((row) => (
      typeof row.id === 'string' && typeof row.name === 'string'
        ? [{ id: row.id, name: row.name }]
        : []
    ))
  } finally {
    await connection.end()
  }
}

export async function readGoldenGlobalCharacter(input: {
  readonly characterId: string
  readonly userId: string
}): Promise<{
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly appearanceDescription: string | null
} | null> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const rows = await queryRows(
      connection,
      `SELECT c.id, c.userId, c.name, a.description AS appearanceDescription
       FROM global_characters c
       LEFT JOIN global_character_appearances a
         ON a.characterId = c.id AND a.appearanceIndex = 0
       WHERE c.id = ? AND c.userId = ?
       LIMIT 1`,
      [input.characterId, input.userId],
    )
    const row = rows[0]
    if (!row || typeof row.id !== 'string' || typeof row.userId !== 'string' || typeof row.name !== 'string') {
      return null
    }
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      appearanceDescription: typeof row.appearanceDescription === 'string' ? row.appearanceDescription : null,
    }
  } finally {
    await connection.end()
  }
}

export async function readGoldenProjectCharacter(input: {
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
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const rows = await queryRows(
      connection,
      `SELECT c.id, c.projectId, c.name, c.sourceGlobalCharacterId, c.profileConfirmed,
              a.description AS appearanceDescription
       FROM project_characters c
       LEFT JOIN character_appearances a
         ON a.characterId = c.id AND a.appearanceIndex = 0
       WHERE c.id = ? AND c.projectId = ?
       LIMIT 1`,
      [input.characterId, input.projectId],
    )
    const row = rows[0]
    if (!row || typeof row.id !== 'string' || typeof row.projectId !== 'string' || typeof row.name !== 'string') {
      return null
    }
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      sourceGlobalCharacterId: typeof row.sourceGlobalCharacterId === 'string' ? row.sourceGlobalCharacterId : null,
      profileConfirmed: row.profileConfirmed === true || row.profileConfirmed === 1 || row.profileConfirmed === '1',
      appearanceDescription: typeof row.appearanceDescription === 'string' ? row.appearanceDescription : null,
    }
  } finally {
    await connection.end()
  }
}

export async function readGoldenProjectCharacterAppearanceCount(input: {
  readonly characterId: string
  readonly projectId: string
}): Promise<number> {
  const connection = await mysql.createConnection(await resolveOracleDatabaseUrl())
  try {
    const rows = await queryRows(
      connection,
      `SELECT COUNT(*) AS count
       FROM character_appearances a
       INNER JOIN project_characters c ON c.id = a.characterId
       WHERE a.characterId = ? AND c.projectId = ?`,
      [input.characterId, input.projectId],
    )
    const count = Number(rows[0]?.count)
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('GOLDEN_PROJECT_CHARACTER_APPEARANCE_COUNT_INVALID')
    }
    return count
  } finally {
    await connection.end()
  }
}

export async function readGoldenOracleSnapshot(scope: GoldenWorkspaceScope): Promise<GoldenOracleSnapshot> {
  const connection = await mysql.createConnection({ uri: await resolveOracleDatabaseUrl(), supportBigNumbers: true })
  try {
    const projectScope = [scope.projectId]
    const episodeScope = [scope.episodeId, scope.projectId]
    const [
      project,
      episode,
      runs,
      activities,
      interruptions,
      waits,
      handoffs,
      checkpoints,
      events,
      tasks,
      taskEvents,
      approvalGrants,
      operationExecutions,
      outboxCommands,
      threads,
      sourceDocuments,
      bibles,
      stylePreviews,
      chapters,
      editScripts,
      shotExecutionPlans,
      storyboards,
      panels,
      videoGroups,
      assetRequirements,
      musicScores,
      soundscapes,
      finalOutputs,
    ] = await Promise.all([
      queryRows(connection, 'SELECT id, userId, name, videoRatio, createdAt, updatedAt FROM projects WHERE id = ?', projectScope),
      queryRows(connection, 'SELECT id, projectId, name, episodeNumber, createdAt, updatedAt FROM project_episodes WHERE id = ? AND projectId = ?', episodeScope),
      queryRows(connection, 'SELECT * FROM project_agent_runs WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_activities WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_interruptions WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_waits WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_execution_handoffs WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT c.* FROM project_agent_continuation_checkpoints c JOIN project_agent_waits w ON w.id = c.waitId WHERE w.projectId = ? AND w.episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_events WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM tasks WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT e.* FROM task_events e JOIN tasks t ON t.id = e.taskId WHERE t.projectId = ? AND t.episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM approval_grants WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM operation_executions WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, "SELECT * FROM outbox_commands WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.projectId')) = ?", [scope.projectId]),
      queryRows(connection, 'SELECT * FROM project_assistant_threads WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT id, episodeId, sourceKind, version, normalizedText, createdAt FROM project_episode_source_documents WHERE episodeId = ? ORDER BY version', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_bibles WHERE episodeId = ?', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_style_previews WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_chapters WHERE episodeId = ?', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_scripts WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_shot_execution_plans WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_storyboards WHERE episodeId = ?', [scope.episodeId]),
      queryRows(connection, 'SELECT p.* FROM project_panels p JOIN project_storyboards s ON s.id = p.storyboardId WHERE s.episodeId = ?', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_video_groups WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_asset_requirements WHERE projectId = ? AND episodeId = ?', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_music_scores WHERE episodeId = ?', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_soundscapes WHERE episodeId = ?', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_episode_final_outputs WHERE episodeId = ?', [scope.episodeId]),
    ])
    const parsedThreads = threads.map((thread) => ({
      ...thread,
      messagesJson: parseJson(thread.messagesJson),
    }))
    return {
      capturedAt: new Date().toISOString(),
      scope,
      project: project[0] ?? null,
      episode: episode[0] ?? null,
      runs: sortOracleRows(runs, 'createdAt', 'id'),
      activities: sortOracleRows(activities, 'createdAt', 'id'),
      interruptions: sortOracleRows(interruptions, 'createdAt', 'id').map((item) => ({ ...item, payload: parseJson(item.payload), response: parseJson(item.response) })),
      waits: sortOracleRows(waits, 'createdAt', 'id'),
      handoffs: sortOracleRows(handoffs, 'createdAt', 'id').map((item) => ({ ...item, payload: parseJson(item.payload) })),
      checkpoints: sortOracleRows(checkpoints, 'startedAt', 'id'),
      events: sortOracleRows(events, 'id').map((item) => ({ ...item, payload: parseJson(item.payload) })),
      tasks: sortOracleRows(tasks, 'createdAt', 'id'),
      taskEvents: sortOracleRows(taskEvents, 'id').map((item) => ({ ...item, payload: parseJson(item.payload) })),
      approvalGrants: sortOracleRows(approvalGrants, 'createdAt', 'id'),
      operationExecutions: sortOracleRows(operationExecutions, 'createdAt', 'id').map((item) => ({ ...item, output: parseJson(item.output) })),
      outboxCommands: outboxCommands.map((item) => ({ ...item, payload: parseJson(item.payload) })),
      threads: sortOracleRows(parsedThreads, 'createdAt', 'id'),
      domain: {
        sourceDocuments,
        bibles: sortOracleRows(bibles, 'createdAt', 'id'),
        stylePreviews: sortOracleRows(stylePreviews, 'createdAt', 'id'),
        chapters: sortOracleRows(chapters, 'chapterIndex', 'id'),
        editScripts: sortOracleRows(editScripts, 'createdAt', 'id'),
        shotExecutionPlans: sortOracleRows(shotExecutionPlans, 'createdAt', 'id'),
        storyboards: sortOracleRows(storyboards, 'createdAt', 'id'),
        panels: sortOracleRows(panels, 'createdAt', 'id'),
        videoGroups: sortOracleRows(videoGroups, 'createdAt', 'id'),
        assetRequirements: sortOracleRows(assetRequirements, 'createdAt', 'id'),
        musicScores: musicScores.map((item) => ({
          ...item,
          cuesJson: parseJson(item.cuesJson),
          mixJson: parseJson(item.mixJson),
          diagnosticsJson: parseJson(item.diagnosticsJson),
        })),
        soundscapes: soundscapes.map((item) => ({
          ...item,
          planJson: parseJson(item.planJson),
          sourcesJson: parseJson(item.sourcesJson),
          mixJson: parseJson(item.mixJson),
          diagnosticsJson: parseJson(item.diagnosticsJson),
        })),
        finalOutputs: sortOracleRows(finalOutputs, 'createdAt', 'id'),
      },
      identities: collectIdentities(parsedThreads),
    }
  } finally {
    await connection.end()
  }
}
