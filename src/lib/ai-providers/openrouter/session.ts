const OPENROUTER_SESSION_ID_MAX_LENGTH = 256
const OPENROUTER_SESSION_ID_SAFE_PATTERN = /[^A-Za-z0-9._:-]+/g

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function normalizeOpenRouterSessionId(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return undefined
  const normalized = trimmed
    .replace(OPENROUTER_SESSION_ID_SAFE_PATTERN, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) return undefined
  return normalized.slice(0, OPENROUTER_SESSION_ID_MAX_LENGTH)
}

export function buildOpenRouterSessionId(input: {
  kind: 'llm' | 'vision' | 'project-agent'
  userId?: string | null
  projectId?: string | null
  assistantId?: string | null
  action?: string | null
  modelKey?: string | null
}): string | undefined {
  const scopeParts = [
    input.kind,
    input.userId,
    input.projectId,
    input.assistantId,
    input.action,
    input.modelKey,
  ].map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)

  if (scopeParts.length === 0) return undefined

  const labelParts = [
    'waoowaoo',
    input.kind,
    input.assistantId || input.action || 'session',
  ]
  return normalizeOpenRouterSessionId(`${labelParts.join(':')}:${stableHash(scopeParts.join('|'))}`)
}

export function buildOpenRouterRequestOptions(
  sessionId: string | null | undefined,
): { headers: Record<string, string> } | undefined {
  const normalized = normalizeOpenRouterSessionId(sessionId)
  if (!normalized) return undefined
  return {
    headers: {
      'x-session-id': normalized,
    },
  }
}
