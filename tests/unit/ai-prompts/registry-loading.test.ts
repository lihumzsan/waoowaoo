import {
  AI_PROMPT_IDS,
  buildAiPrompt,
  describe,
  expect,
  getAiPromptTemplate,
  it,
  join,
  mkdirSync,
  mkdtempSync,
  rmSync,
  tmpdir,
  vi,
  writeFileSync,
} from './registry.fixture'

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

  it('reloads prompt template file changes within the same process', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'ai-prompt-template-'))
    const templateDir = join(tempRoot, 'src', 'lib', 'ai-prompts', 'templates', 'character', 'create')
    const templatePath = join(templateDir, 'character-create.zh.txt')
    mkdirSync(templateDir, { recursive: true })

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempRoot)
    try {
      writeFileSync(templatePath, 'template before edit', 'utf-8')
      expect(getAiPromptTemplate(AI_PROMPT_IDS.CHARACTER_CREATE, 'zh')).toBe('template before edit')

      writeFileSync(templatePath, 'template after edit', 'utf-8')
      expect(getAiPromptTemplate(AI_PROMPT_IDS.CHARACTER_CREATE, 'zh')).toBe('template after edit')
    } finally {
      cwdSpy.mockRestore()
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('loads the edit bible global template', () => {
    const prompt = buildAiPrompt({
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      locale: 'zh',
      variables: {
        source_document: '标题：《旧钟》',
        source_length: '6',
      },
    })

    expect(prompt).toContain('带编号的剧本原文块')
    expect(prompt).toContain('标题：《旧钟》')
    expect(prompt).not.toContain('firstEvidence')
    expect(prompt).not.toContain('"firstSourceStart":')
  })
})
