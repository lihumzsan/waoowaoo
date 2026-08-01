import {
  AI_PROMPT_IDS,
  buildAiPrompt,
  HUMAN_VISUAL_SAFETY_POLICY,
} from '@/lib/ai-prompts'

export function buildProjectAgentSystemPrompt(params: {
  projectId: string
  episodeId: string
}): string {
  return buildAiPrompt({
    promptId: AI_PROMPT_IDS.PROJECT_AGENT_SYSTEM,
    variables: {
      project_id: params.projectId,
      episode_id: params.episodeId,
      human_visual_safety_policy: HUMAN_VISUAL_SAFETY_POLICY,
    },
  })
}
