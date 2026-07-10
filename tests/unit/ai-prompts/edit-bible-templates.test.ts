import {
  AI_PROMPT_IDS,
  buildAiPrompt,
  describe,
  editBibleJsonPromptIds,
  enJsonPromptSections,
  expect,
  getAiPromptTemplate,
  internalPipelineTerms,
  it,
  zhJsonPromptSections,
} from './registry.fixture'

describe('ai prompt registry', () => {
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

  it('keeps internal pipeline terminology out of edit bible extraction prompts', () => {
    for (const promptId of [...editBibleJsonPromptIds, AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT]) {
      const zhTemplate = getAiPromptTemplate(promptId, 'zh')
      const enTemplate = getAiPromptTemplate(promptId, 'en')

      for (const term of internalPipelineTerms) {
        expect(zhTemplate, `${promptId} zh should not contain ${term}`).not.toContain(term)
        expect(enTemplate.toLowerCase(), `${promptId} en should not contain ${term}`).not.toContain(term.toLowerCase())
      }
      expect(zhTemplate).not.toContain('{{source_checksum}}')
      expect(enTemplate).not.toContain('{{source_checksum}}')
    }
  })

  it('renders all edit bible prompt variables through the unified builder', () => {
    for (const promptId of editBibleJsonPromptIds) {
      const prompt = buildAiPrompt({
      promptId,
      locale: 'en',
      variables: {
        source_document: 'Mira opens the sealed observatory.',
        source_length: '35',
        ...(promptId === AI_PROMPT_IDS.EDIT_BIBLE_LEDGER
          ? {
              beat_sheet: '{"beats":[]}',
              entity_catalog: '{"characters":[],"locations":[]}',
            }
          : {}),
      },
      })

      expect(prompt).toContain('Mira opens the sealed observatory.')
      expect(prompt).toContain('35')
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

  it('keeps beat extraction constraints without exposing chapter-splitting internals', () => {
    const zhTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET, 'zh')
    const enTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET, 'en')

    expect(zhTemplate).toContain('不要把它们组织成章节')
    expect(zhTemplate).toContain('15-45 秒')
    expect(zhTemplate).toContain('120 秒')
    expect(zhTemplate).toContain('自然剧情转折')
    expect(zhTemplate).not.toContain('切分算法')
    expect(zhTemplate).not.toContain('系统代码')

    expect(enTemplate).toContain('Do not organize them into chapters')
    expect(enTemplate).toContain('15-45 seconds')
    expect(enTemplate).toContain('120 seconds')
    expect(enTemplate).toContain('natural story turns')
    expect(enTemplate).not.toContain('algorithm')
    expect(enTemplate).not.toContain('System code')
  })

  it('keeps edit bible outline generation as structured source script output', () => {
    const zhTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT, 'zh')
    const enTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT, 'en')

    expect(zhTemplate).toContain('# 角色与目标')
    expect(zhTemplate).toContain('# 输出格式')
    expect(zhTemplate).toContain('# 单一事实规则')
    expect(zhTemplate).toContain('"segments"')
    expect(zhTemplate).toContain('"episodeIndex"')
    expect(zhTemplate).toContain('"sceneIndex"')
    expect(zhTemplate).toContain('只输出一个 JSON 对象')
    expect(zhTemplate).toContain('`body`')
    expect(zhTemplate).toContain('目标时长')
    expect(zhTemplate).toContain('场景数量、对白密度、动作、停顿、转场和节奏')
    expect(zhTemplate).toContain('10000 个字符')
    expect(zhTemplate).toContain('不要再输出 `scriptText`、`structure` 或 `episodes`')

    expect(enTemplate).toContain('# Role and Goal')
    expect(enTemplate).toContain('# Output Format')
    expect(enTemplate).toContain('# Single-Source Rules')
    expect(enTemplate).toContain('"segments"')
    expect(enTemplate).toContain('"episodeIndex"')
    expect(enTemplate).toContain('"sceneIndex"')
    expect(enTemplate).toContain('Output exactly one JSON object')
    expect(enTemplate).toContain('`body`')
    expect(enTemplate).toContain('target runtime')
    expect(enTemplate).toContain('scene count, dialogue density, action, pauses, transitions, and pacing')
    expect(enTemplate).toContain('10,000 characters')
    expect(enTemplate).toContain('Do not output `scriptText`, `structure`, or `episodes`')
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
        asset_menu_json: '{"locations":[{"id":"loc-1","name":"地下室","description":"地下室"}],"characters":[{"id":"char-1","name":"林小雨","description":"主角"}]}',
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

    expect(executionTemplate).toContain('camera.lighting')
    expect(executionTemplate).toContain('blocking.axis')
    expect(executionTemplate).toContain('continuousVideoPrompt')
    expect(executionTemplate).toContain('blocking.characters[] 中的每一个人物对象都必须输出且只输出')
    expect(executionTemplate).toContain('即使 visibility 是 `hidden`、`occluded` 或 `offscreen`')
    expect(executionTemplate).toContain('blocking.objects[] 中的每一个物体对象都必须输出且只输出')
    expect(executionTemplate).toContain('禁止给物体输出 facing、eyeline、visibility、role 或任何其他字段')
    expect(executionTemplate).toContain('blocking.axis.subjects 必须是非空字符串数组')
    expect(executionTemplate).toContain('videoGenerationSegments[].continuityReference')
    expect(executionTemplate).toContain('不要输出 continuity、description、summary 或任何其他字段')
    expect(executionTemplate).toContain('只返回 JSON')
  })

  it('keeps English shot execution prompt strict about character and object fields', () => {
    const executionTemplate = getAiPromptTemplate(AI_PROMPT_IDS.EDIT_SCRIPT_SHOT_EXECUTION_PLAN, 'en')

    expect(executionTemplate).toContain('Every item in `blocking.characters[]` must output exactly these six fields')
    expect(executionTemplate).toContain('Even when visibility is `hidden`, `occluded`, or `offscreen`')
    expect(executionTemplate).toContain('Every item in `blocking.objects[]` must output exactly these three fields')
    expect(executionTemplate).toContain('Do not output `facing`, `eyeline`, `visibility`, `role`, or any other field for objects')
    expect(executionTemplate).toContain('blocking.axis.subjects must be a non-empty string array')
    expect(executionTemplate).toContain('videoGenerationSegments[].continuityReference')
    expect(executionTemplate).toContain('Do not output continuity, description, summary, or any other field')
  })
})
