import { describe, expect, it } from 'vitest'
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
  '# 术语说明',
  '# 事实来源',
  '# 工作规则',
  '# 输入',
  '# 输出 Schema',
  '# 自检',
] as const

const enJsonPromptSections = [
  '# Role and Goal',
  '# Terminology',
  '# Fact Sources',
  '# Rules',
  '# Input',
  '# Output Schema',
  '# Self-check',
] as const

describe('ai prompt registry', () => {
  it('renders placeholders through the unified prompt builder', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.CHARACTER_CREATE,
      locale: 'zh',
      variables: {
        user_input: '创建一个阴郁的老管家',
      },
    })

    expect(prompt).toContain('创建一个阴郁的老管家')
  })

  it('loads the edit bible global template', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      locale: 'zh',
      variables: {
        source_document: '标题：《旧钟》',
        source_checksum: 'checksum-1',
      },
    })

    expect(prompt).toContain('长视频全局 Bible')
    expect(prompt).toContain('全局 Bible')
    expect(prompt).toContain('标题：《旧钟》')
    expect(prompt).toContain('checksum-1')
  })

  it('keeps edit bible extraction prompts aligned with the structured template style', () => {
    for (const promptId of editBibleJsonPromptIds) {
      const zhTemplate = getAiPromptTemplate(promptId, 'zh')
      const enTemplate = getAiPromptTemplate(promptId, 'en')

      for (const section of zhJsonPromptSections) {
        expect(zhTemplate).toContain(section)
      }
      for (const section of enJsonPromptSections) {
        expect(enTemplate).toContain(section)
      }

      expect(zhTemplate).toContain('只返回 JSON')
      expect(enTemplate).toContain('Return JSON only')
    }
  })

  it('renders all edit bible prompt variables through the unified builder', () => {
    for (const promptId of editBibleJsonPromptIds) {
      const prompt = buildAiPrompt({
        promptId,
        locale: 'en',
        variables: {
          source_document: 'Mira opens the sealed observatory.',
          source_checksum: 'source-checksum-2',
        },
      })

      expect(prompt).toContain('Mira opens the sealed observatory.')
      expect(prompt).toContain('source-checksum-2')
    }

    const outlinePrompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      locale: 'en',
      variables: {
        user_prompt: 'A clockmaker finds a second midnight inside an old tower.',
      },
    })

    expect(outlinePrompt).toContain('A clockmaker finds a second midnight inside an old tower.')
  })

  it('keeps edit bible beat extraction separate from deterministic chapter splitting', () => {
    const zhTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET, 'zh')
    const enTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET, 'en')

    expect(zhTemplate).toContain('不是最终 chapter')
    expect(zhTemplate).toContain('本任务不输出 chapter')
    expect(zhTemplate).toContain('系统代码会根据 beat 时长')
    expect(zhTemplate).toContain('15-45 秒')
    expect(zhTemplate).toContain('120 秒')
    expect(zhTemplate).toContain('3,600')

    expect(enTemplate).toContain('It is not the final chapter')
    expect(enTemplate).toContain('Do not output chapters')
    expect(enTemplate).toContain('System code will merge adjacent beats')
    expect(enTemplate).toContain('15-45 seconds')
    expect(enTemplate).toContain('120 seconds')
    expect(enTemplate).toContain('3,600')
  })

  it('keeps edit bible outline generation as plain source script text', () => {
    const zhTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT, 'zh')
    const enTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT, 'en')

    expect(zhTemplate).toContain('# 角色与目标')
    expect(zhTemplate).toContain('# 事实来源')
    expect(zhTemplate).toContain('# 工作规则')
    expect(zhTemplate).toContain('只输出纯剧本文本')
    expect(zhTemplate).toContain('不要把内容写成 bullet list、设定表、章节大纲或镜头清单')
    expect(zhTemplate).toContain('10,000 字符')

    expect(enTemplate).toContain('# Role and Goal')
    expect(enTemplate).toContain('# Fact Sources')
    expect(enTemplate).toContain('# Rules')
    expect(enTemplate).toContain('Output plain script text only')
    expect(enTemplate).toContain('Do not write bullet lists, setting tables, chapter outlines, or shot lists')
    expect(enTemplate).toContain('10,000 characters')
  })

  it('renders edit structure generation segment duration constraints', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_SCRIPT_STRUCTURE,
      locale: 'zh',
      variables: {
        user_request: '做一个恐怖短片',
        bible_text: '林小雨听到门外异响。',
        story_bible_json: '{"characters":[],"locations":[]}',
        entry_snapshot_json: '{"facts":[],"entities":[]}',
        chapter_events_json: '[]',
        duration_guidance: '短时长档位，约 30 秒。',
        generation_segment_max_duration_seconds: '15',
        aspect_ratio: '16:9',
        style_bible_json: '{}',
      },
    })

    expect(prompt).toContain('不得超过 15 秒')
    expect(prompt).toContain('逐段累加 durationSec')
  })

  it('keeps Chinese canvas-visible prompt templates from requiring English prompt output', () => {
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'zh')

    expect(executionTemplate).toContain('ShotExecutionPlan')
    expect(executionTemplate).toContain('camera.lighting')
    expect(executionTemplate).toContain('blocking.axis')
    expect(executionTemplate).toContain('continuousVideoPrompt')
    expect(executionTemplate).toContain('blocking.characters[] 中的每一个人物对象都必须输出且只输出')
    expect(executionTemplate).toContain('即使 visibility 是 `hidden`、`occluded` 或 `offscreen`')
    expect(executionTemplate).toContain('blocking.objects[] 中的每一个物体对象都必须输出且只输出')
    expect(executionTemplate).toContain('禁止给物体输出 facing、eyeline、visibility、role 或任何其他字段')
    expect(executionTemplate).toContain('只返回 JSON')
  })

  it('keeps English shot execution prompt strict about character and object fields', () => {
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'en')

    expect(executionTemplate).toContain('Every item in `blocking.characters[]` must output exactly these six fields')
    expect(executionTemplate).toContain('Even when visibility is `hidden`, `occluded`, or `offscreen`')
    expect(executionTemplate).toContain('Every item in `blocking.objects[]` must output exactly these three fields')
    expect(executionTemplate).toContain('Do not output `facing`, `eyeline`, `visibility`, `role`, or any other field for objects')
  })
})
