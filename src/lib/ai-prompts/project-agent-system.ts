import fs from 'node:fs'
import path from 'node:path'

const PROJECT_AGENT_SYSTEM_PROMPT_PATH = path.join(
  process.cwd(),
  'src',
  'lib',
  'ai-prompts',
  'templates',
  'project-agent',
  'system',
  'project-agent-system.txt',
)

const PROJECT_AGENT_BASE_PROMPT_PATH = path.join(
  process.cwd(),
  'src',
  'lib',
  'ai-prompts',
  'templates',
  'project-agent',
  'system',
  'project-agent-base.txt',
)

const CREATIVE_SKILL_ROUTING_PLACEHOLDER = '{creative_skill_routing}'

export function buildProjectAgentBasePrompt(): string {
  return fs.readFileSync(PROJECT_AGENT_BASE_PROMPT_PATH, 'utf8').trim()
}

export function buildProjectAgentSystemPrompt(
  creativeSkillRouting: readonly string[],
): string {
  const template = fs.readFileSync(PROJECT_AGENT_SYSTEM_PROMPT_PATH, 'utf8')
  if (!template.includes(CREATIVE_SKILL_ROUTING_PLACEHOLDER)) {
    throw new Error('PROJECT_AGENT_SYSTEM_PROMPT_ROUTING_PLACEHOLDER_REQUIRED')
  }
  return template.replace(
    CREATIVE_SKILL_ROUTING_PLACEHOLDER,
    creativeSkillRouting.map((line) => `- ${line}`).join('\n'),
  ).trim()
}
