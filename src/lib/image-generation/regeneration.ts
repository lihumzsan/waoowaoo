import { randomUUID } from 'node:crypto'

const SAFE_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/

const CHARACTER_WARDROBE_TERMS = [
  '身穿',
  '穿着',
  '外搭',
  '内搭',
  '脚穿',
  '佩戴',
  '配戴',
  '配饰',
  '腕表',
  '手表',
  '衬衫',
  '外套',
  '连帽',
  '长裤',
  '短裤',
  '裤',
  '短靴',
  '靴',
  '鞋',
  '夹克',
  '卫衣',
  '毛衣',
  '针织',
  '裙',
  '帽',
  '围巾',
  '领带',
  '制服',
  '西装',
  '大衣',
  '风衣',
  't恤',
  'T恤',
  '背包',
  'wearing',
  'wears',
  'outfit',
  'hoodie',
  'shirt',
  'pants',
  'trousers',
  'boots',
  'shoes',
  'jacket',
  'coat',
  'accessory',
  'watch',
]

const CHARACTER_WARDROBE_DIRECTIONS = [
  '深海军蓝短款飞行夹克，雾绿色针织内搭，炭灰锥形裤，黑白运动鞋，轻薄斜挎包',
  '橄榄绿工装衬衫外套，黑色圆领内搭，深色直筒牛仔裤，白色低帮板鞋，细银色吊坠',
  '米驼色短款工装夹克，浅蓝内搭，黑色直筒长裤，棕色短靴，简洁皮质手环',
  '墨绿色无帽夹克，浅灰高领内搭，深蓝宽松长裤，黑色运动鞋，窄边金属腕饰',
  '炭黑短款棒球夹克，暖白针织衫，卡其休闲裤，深色帆布鞋，小型胸针或钥匙扣',
  '浅褐色开衫外套，深灰 T 恤，藏青束脚裤，米色休闲鞋，细织物手绳',
]

export function createRegenerationToken(): string {
  return `regen-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function normalizeRegenerationToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  if (!SAFE_TOKEN_PATTERN.test(token)) return null
  return token
}

function buildRegenerationPromptToken(
  tokenValue: unknown,
  context?: {
    variationIndex?: number
    variationCount?: number
  },
): string | null {
  const token = normalizeRegenerationToken(tokenValue)
  if (!token) return null

  const variationIndex = typeof context?.variationIndex === 'number' && Number.isFinite(context.variationIndex)
    ? Math.max(0, Math.floor(context.variationIndex))
    : null
  const variationCount = typeof context?.variationCount === 'number' && Number.isFinite(context.variationCount)
    ? Math.max(1, Math.floor(context.variationCount))
    : null

  if (variationIndex === null) return token

  return `${token}-img-${variationIndex + 1}-of-${variationCount ?? variationIndex + 1}`
}

function stableIndexFromToken(token: string, length: number): number {
  if (length <= 1) return 0
  let hash = 0
  for (let i = 0; i < token.length; i++) {
    hash = ((hash * 31) + token.charCodeAt(i)) >>> 0
  }
  return hash % length
}

function containsWardrobeTerm(value: string): boolean {
  const lower = value.toLowerCase()
  return CHARACTER_WARDROBE_TERMS.some((term) => lower.includes(term.toLowerCase()))
}

function stripWardrobeClauses(description: string): string {
  const sentences = description.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [description]
  const stripped = sentences
    .map((sentence) => {
      const trimmed = sentence.trim()
      if (!trimmed) return ''

      const endMark = trimmed.match(/[。！？.!?]$/)?.[0] ?? ''
      const body = endMark ? trimmed.slice(0, -1) : trimmed
      const clauses = body
        .split(/[，,；;、]/)
        .map((clause) => clause.trim())
        .filter(Boolean)
      const keptClauses = clauses.filter((clause) => !containsWardrobeTerm(clause))
      if (keptClauses.length === 0) return ''
      return `${keptClauses.join('，')}${endMark || '。'}`
    })
    .join('')
    .trim()

  return stripped || description
}

export function buildCharacterRegenerationDescription(
  description: string,
  tokenValue: unknown,
  context?: {
    variationIndex?: number
    variationCount?: number
  },
): string {
  const token = buildRegenerationPromptToken(tokenValue, context)
  if (!token) return description

  const strippedDescription = stripWardrobeClauses(description)
  const wardrobeDirection = CHARACTER_WARDROBE_DIRECTIONS[
    stableIndexFromToken(token, CHARACTER_WARDROBE_DIRECTIONS.length)
  ] ?? CHARACTER_WARDROBE_DIRECTIONS[0]

  return [
    strippedDescription,
    `Regeneration wardrobe redesign ${token}: preserve the character's gender presentation, face, age, body shape, hairstyle family, and story role, but design a clearly different outfit and accessory set for this render. Suggested alternate styling: ${wardrobeDirection}. Use this new wardrobe direction as the positive clothing target.`,
  ].filter(Boolean).join('\n')
}

export function appendRegenerationPromptInstruction(
  prompt: string,
  tokenValue: unknown,
  context?: {
    variationIndex?: number
    variationCount?: number
  },
): string {
  const token = buildRegenerationPromptToken(tokenValue, context)
  if (!token) return prompt

  return [
    prompt,
    `FINAL REGENERATION OVERRIDE. Regeneration variation token: ${token}. Use this token only as private randomness; do not render or write it. Create a fresh alternate render, not a near-duplicate. Keep the same target identity, gender presentation, age, body type, face family, required asset-sheet layout, and core story role, but make the result visibly different from earlier outputs. This final instruction overrides earlier exact wardrobe, clothing color, accessory, pose, crop, and surface-detail descriptions when they conflict with visible variation. For character regeneration, exact garment names, garment colors, accessories, and stance from the base description are previous-draft details, not identity locks. Do not repeat the same garment and color combination if the prompt names one; choose a clearly new outfit palette, silhouette, layering, accessory set, and pose energy while preserving the same face, gender presentation, and role. Change at least three secondary elements: for characters, vary outfit silhouette or layers, fabric colors or materials, accessories or small props, hair styling details, stance or pose energy, and lighting accents; for locations or props, vary arrangement, surface materials, structural details, silhouettes, design motifs, lighting, and color accents. Always redraw the image from scratch; do not clone the previous render's exact clothing, pose, crop, composition, or surface details.`,
  ].filter(Boolean).join('\n\n')
}
