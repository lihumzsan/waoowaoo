import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { buildAiPrompt, getAiPromptTemplate } from '@/lib/ai-prompts'

import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'

const editBibleJsonPromptIds = [
  AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
  AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
  AI_PROMPT_IDS.EDIT_BIBLE_LEDGER,
  AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE,
] as const

const zhJsonPromptSections = [
  '# 角色与目标',
  '# 事实来源',
  '# 工作规则',
  '# 输入',
  '# 输出 Schema',
  '# 自检',
] as const

const enJsonPromptSections = [
  '# Role and Goal',
  '# Fact Sources',
  '# Rules',
  '# Input',
  '# Output Schema',
  '# Self-check',
] as const

const internalPipelineTerms = [
  'SourceDocument',
  '归一化',
  '术语说明',
  '本系统',
  'checksum',
] as const

export { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
export { tmpdir } from 'node:os'
export { join } from 'node:path'
export { describe, expect, it, vi } from 'vitest'
export { buildAiPrompt, getAiPromptTemplate } from '@/lib/ai-prompts'
export { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
export { editBibleJsonPromptIds, enJsonPromptSections, internalPipelineTerms, zhJsonPromptSections }
