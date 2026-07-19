import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import type { ProjectAgentLocale } from './locale'

export function buildProjectAgentSystemPrompt(params: {
  locale: ProjectAgentLocale
  projectId: string
  episodeId: string
}): string {
  return buildAiPrompt({
    promptId: AI_PROMPT_IDS.PROJECT_AGENT_SYSTEM,
    locale: params.locale,
    variables: {
      project_id: params.projectId,
      episode_id: params.episodeId,
    },
  })
}
