import fs from 'node:fs'
import path from 'node:path'
import { AI_PROMPT_CATALOG } from './registry'
import type { AiPromptId } from './ids'
import type { AiPromptLocale } from './types'

export function getAiPromptTemplate(promptId: AiPromptId, locale: AiPromptLocale): string {
  const entry = AI_PROMPT_CATALOG[promptId]
  if (!entry) {
    throw new Error(`AI_PROMPT_ID_UNREGISTERED:${promptId}`)
  }

  const filePath = path.join(process.cwd(), 'src', 'lib', 'ai-prompts', 'templates', entry.pathStem, `${promptId}.${locale}.txt`)
  return fs.readFileSync(filePath, 'utf-8')
}
