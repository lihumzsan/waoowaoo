import { buildOpenRouterSessionId } from '@/lib/ai-providers/openrouter/session'

export type AiExecutionSessionKind = 'llm' | 'vision' | 'project-agent'

export type AiExecutionSessionScope = {
  kind: AiExecutionSessionKind
  userId?: string | null
  projectId?: string | null
  assistantId?: string | null
  action?: string | null
  modelKey?: string | null
}

export function buildAiExecutionSessionId(input: AiExecutionSessionScope): string | undefined {
  return buildOpenRouterSessionId(input)
}
