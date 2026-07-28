import fs from 'node:fs'
import path from 'node:path'
import { AI_PROMPT_CATALOG } from './registry'
import type { AiPromptId } from './ids'

export function getAiPromptTemplate(promptId: AiPromptId): string {
  const entry = AI_PROMPT_CATALOG[promptId]
  if (!entry) {
    throw new Error(`AI_PROMPT_ID_UNREGISTERED:${promptId}`)
  }

  const filePath = path.join(process.cwd(), 'src', 'lib', 'ai-prompts', 'templates', entry.pathStem, `${promptId}.txt`)
  return fs.readFileSync(filePath, 'utf-8')
}
