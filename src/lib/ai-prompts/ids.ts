export const AI_PROMPT_IDS = {
  PROJECT_AGENT_SYSTEM: 'project-agent-system',
  PROJECT_AGENT_CONVERSATION_SUMMARY: 'project-agent-conversation-summary',
} as const

export type AiPromptId = (typeof AI_PROMPT_IDS)[keyof typeof AI_PROMPT_IDS]
