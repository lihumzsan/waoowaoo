import type { Locale } from '@/i18n/routing'
import type { EditScriptStyleBible } from '@/lib/edit-script/types'
import { renderStyleBiblePromptBlock } from '@/lib/edit-script/style-bible-prompt'

export const CHARACTER_CANDIDATE_PROMPT_COUNT = 3

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function joinLines(lines: ReadonlyArray<string | null>): string {
  return lines
    .map((line) => line?.trim() || '')
    .filter((line) => line.length > 0)
    .join('\n')
}

export function buildCharacterCandidatePromptInstruction(input: {
  readonly description: string
  readonly locale: Locale
  readonly styleBible: EditScriptStyleBible | null
}): string {
  const description = normalizeText(input.description)
  const styleBlock = input.styleBible
    ? renderStyleBiblePromptBlock({
      styleBible: input.styleBible,
      usage: 'assetImage',
      locale: input.locale,
    })
    : null

  if (input.locale === 'en') {
    return joinLines([
      'You are a casting-aware character visual designer for a full-reference video asset pipeline.',
      'Generate three distinct image-generation prompts for the same character. These prompts will be used to create three candidate character asset boards, then a user will choose one default reference.',
      `Base character input: ${description}`,
      styleBlock ? `Project Style Bible:\n${styleBlock}` : null,
      'Rules:',
      '- Output exactly three prompts for the same character identity, not three different characters.',
      '- Each prompt must be a final image prompt fragment only: character identity, silhouette, age impression, body type, face/hair direction, clothing design, wearable accessories, material texture, and reusable role-specific pose/context samples.',
      '- Let the AI image model keep reasonable design freedom. Do not lock every facial feature, exact hair strand, color swatch, or accessory unless the input requires it.',
      '- The three prompts must differ by design emphasis: 1) faithful identity and silhouette, 2) wardrobe/material/era texture, 3) role energy and video-reference usability.',
      '- If a Style Bible is provided, make the casting, clothing, palette, texture, and atmosphere compatible with it inside the prompt wording.',
      '- Do not include layout instructions, aspect ratio, watermark rules, text labels, or image count. The system suffix will add the asset-board structure later.',
      'Output JSON only: {"prompts":["prompt 1","prompt 2","prompt 3"]}.',
    ])
  }

  return joinLines([
    '你是电影分镜资产链路中的选角型角色视觉设计师。',
    '请为同一个角色生成三条不同的最终图片生成提示词。这三条提示词会分别生成三张候选角色资产板，之后由用户选择一张作为默认参考。',
    `基础角色输入：${description}`,
    styleBlock ? `项目 Style Bible：\n${styleBlock}` : null,
    '规则：',
    '- 必须输出同一个角色身份的三组形象候选，不是三个不同角色。',
    '- 每条 prompt 只能是最终生图提示词片段：角色身份、轮廓、年龄感、体型、五官/发型方向、服装设计、可穿戴配饰、材质质感，以及可复用的职业/身份姿态或语境样本。',
    '- 给生图模型保留合理发挥空间。除非输入明确要求，不要把每一个五官细节、发丝、色块、配饰都写死。',
    '- 三条 prompt 必须侧重点不同：1）身份与轮廓忠实版，2）服装/材质/年代质感版，3）角色能量与分镜可用性版。',
    '- 如果存在 Style Bible，必须把选角、服装、色彩、材质和氛围写成与它兼容的视觉描述。',
    '- 不要写版式、画幅比例、水印规则、文字标签或图片数量；资产板结构会由系统后缀统一追加。',
    '只输出 JSON：{"prompts":["提示词1","提示词2","提示词3"]}。',
  ])
}

function readPromptString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const prompt = record.prompt
  if (typeof prompt !== 'string') return null
  const trimmed = prompt.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function parseCharacterCandidatePrompts(parsed: Record<string, unknown>): string[] {
  const rawPrompts = parsed.prompts
  if (!Array.isArray(rawPrompts)) {
    throw new Error('CHARACTER_CANDIDATE_PROMPTS_INVALID')
  }

  const prompts = rawPrompts
    .map((value) => readPromptString(value))
    .filter((value): value is string => value !== null)

  if (prompts.length !== CHARACTER_CANDIDATE_PROMPT_COUNT) {
    throw new Error('CHARACTER_CANDIDATE_PROMPTS_INVALID')
  }

  return prompts
}
