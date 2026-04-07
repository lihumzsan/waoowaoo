import { describe, expect, it } from 'vitest'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

describe('select prop prompt template', () => {
  it('zh template restricts extraction to recurring unique props and rejects ordinary scene items', () => {
    const template = getPromptTemplate(PROMPT_IDS.NP_SELECT_PROP, 'zh')

    expect(template).toContain('关键剧情道具资产分析师')
    expect(template).toContain('宁缺毋滥')
    expect(template).toContain('明确文本证据')
    expect(template).toContain('普通可替换物件')
    expect(template).toContain('可替换性测试')
    expect(template).toContain('贯穿性测试')
    expect(template).toContain('餐厅里的叉子')
    expect(template).toContain('如果不确定它是否值得进入资产库，直接不输出')
    expect(template).toContain('仅因外观具体、名词明确，不足以成为关键道具')
  })

  it('en template restricts extraction to recurring unique props and rejects ordinary scene items', () => {
    const template = getPromptTemplate(PROMPT_IDS.NP_SELECT_PROP, 'en')

    expect(template).toContain('key story prop extractor')
    expect(template).toContain('Be conservative')
    expect(template).toContain('explicit textual evidence')
    expect(template).toContain('Ordinary replaceable items')
    expect(template).toContain('Replaceability test')
    expect(template).toContain('Continuity test')
    expect(template).toContain('a fork in a restaurant')
    expect(template).toContain('If you are unsure whether it deserves an asset entry, do not output it')
    expect(template).toContain('A specific-looking noun is not enough')
  })
})
