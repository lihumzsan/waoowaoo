import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import type { ProjectAgentLocale } from './locale'
import type { AssistantPermissionMode } from './permission-mode'

export function buildProjectAgentSystemPrompt(params: {
  locale: ProjectAgentLocale
  projectId: string
  episodeId: string
  assistantPermissionMode: AssistantPermissionMode
}): string {
  return buildAiPrompt({
    promptId: AI_PROMPT_IDS.PROJECT_AGENT_SYSTEM,
    locale: params.locale,
    variables: {
      assistant_permission_mode: params.assistantPermissionMode,
      project_id: params.projectId,
      episode_id: params.episodeId,
    },
  })
}
