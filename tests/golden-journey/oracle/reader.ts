import mysql, { type RowDataPacket } from 'mysql2/promise'
import type { GoldenWorkspaceScope } from '../browser/pages/home'
import type {
  GoldenOracleIdentitySummary,
  GoldenOracleSnapshot,
} from './types'

const ORACLE_DATABASE_URL = process.env.GOLDEN_ORACLE_DATABASE_URL
  ?? 'mysql://golden_oracle:golden_oracle_password@127.0.0.1:3307/waoowaoo_test'

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

export async function assertGoldenOracleIsReadOnly(): Promise<void> {
  const connection = await mysql.createConnection(ORACLE_DATABASE_URL)
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

export async function readGoldenOracleSnapshot(scope: GoldenWorkspaceScope): Promise<GoldenOracleSnapshot> {
  const connection = await mysql.createConnection({ uri: ORACLE_DATABASE_URL, supportBigNumbers: true })
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
      finalOutputs,
    ] = await Promise.all([
      queryRows(connection, 'SELECT id, userId, name, videoRatio, createdAt, updatedAt FROM projects WHERE id = ?', projectScope),
      queryRows(connection, 'SELECT id, projectId, name, episodeNumber, createdAt, updatedAt FROM project_episodes WHERE id = ? AND projectId = ?', episodeScope),
      queryRows(connection, 'SELECT * FROM project_agent_runs WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_activities WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_interruptions WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_waits WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_execution_handoffs WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT c.* FROM project_agent_continuation_checkpoints c JOIN project_agent_waits w ON w.id = c.waitId WHERE w.projectId = ? AND w.episodeId = ? ORDER BY c.startedAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_agent_events WHERE projectId = ? AND episodeId = ? ORDER BY id', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM tasks WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT e.* FROM task_events e JOIN tasks t ON t.id = e.taskId WHERE t.projectId = ? AND t.episodeId = ? ORDER BY e.id', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM approval_grants WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM operation_executions WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, "SELECT * FROM outbox_commands WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.projectId')) = ? ORDER BY createdAt", [scope.projectId]),
      queryRows(connection, 'SELECT * FROM project_assistant_threads WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT id, episodeId, sourceKind, version, normalizedText, createdAt FROM project_episode_source_documents WHERE episodeId = ? ORDER BY version', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_bibles WHERE episodeId = ? ORDER BY createdAt', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_style_previews WHERE projectId = ? AND episodeId = ? ORDER BY createdAt', [scope.projectId, scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_edit_chapters WHERE episodeId = ? ORDER BY chapterIndex', [scope.episodeId]),
      queryRows(connection, 'SELECT * FROM project_episode_final_outputs WHERE episodeId = ? ORDER BY createdAt', [scope.episodeId]),
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
      runs,
      activities,
      interruptions: interruptions.map((item) => ({ ...item, payload: parseJson(item.payload), response: parseJson(item.response) })),
      waits,
      handoffs: handoffs.map((item) => ({ ...item, payload: parseJson(item.payload) })),
      checkpoints,
      events: events.map((item) => ({ ...item, payload: parseJson(item.payload) })),
      tasks,
      taskEvents: taskEvents.map((item) => ({ ...item, payload: parseJson(item.payload) })),
      approvalGrants,
      operationExecutions: operationExecutions.map((item) => ({ ...item, output: parseJson(item.output) })),
      outboxCommands: outboxCommands.map((item) => ({ ...item, payload: parseJson(item.payload) })),
      threads: parsedThreads,
      domain: { sourceDocuments, bibles, stylePreviews, chapters, finalOutputs },
      identities: collectIdentities(parsedThreads),
    }
  } finally {
    await connection.end()
  }
}
