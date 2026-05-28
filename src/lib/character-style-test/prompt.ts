import type { Locale } from '@/i18n/routing'
import { CHARACTER_ASSET_IMAGE_RATIO } from '@/lib/constants'

export const CHARACTER_STYLE_TEST_ASPECT_RATIO = CHARACTER_ASSET_IMAGE_RATIO

function normalizeCharacterRequest(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function buildCharacterStyleTestStyleSummary(input: {
  readonly characterRequest: string
  readonly locale: Locale
}): string {
  const characterRequest = normalizeCharacterRequest(input.characterRequest)
  return input.locale === 'en'
    ? `Input-derived temporary asset style source: ${characterRequest}`
    : `本次临时资产风格来源：${characterRequest}`
}

function buildChineseBasePrompt(characterRequest: string): string {
  return [
    '生成一张用于后续分镜参考的风格化角色资产设定图。',
    `用户输入（本次人物与风格的唯一来源）：${characterRequest}`,
    '先根据用户输入在内部归纳一份“本次角色资产风格规范”，必须覆盖：角色身份与轮廓、背景氛围、灯光策略、色彩方案、画面滤镜、材质质感、构图规则、禁止项。若用户没有明确写某一项，只能从输入语义中合理推导，不要引用项目 Style Bible，不要继承项目既有风格，不要使用默认白底模板。',
    '画面必须保持单张完整图片，不要拆成多张输出。',
    '版式必须保留角色多视图：左侧约 1/3 宽度为角色大头正面身份特写；右侧约 2/3 宽度横向排列同一角色的正面全身、侧面全身、背面全身，三视图高度一致，服装和体型完全一致。',
    '资产图不能使用纯白底。必须把内部归纳出的背景、灯光、滤镜、色彩、材质和画面质感落实到画面里；背景只能服务于资产风格，不得绑定具体剧情地点，不得出现可误导分镜的固定场景锚点。',
    '这张图后续会被分镜图片当作人物参考资产，因此风格必须稳定、可复用、能被后续镜头继承；不要生成普通证件照、白底三视图或无风格的建模参考图。',
    '让角色外观、服装、轮廓、发型、体型、主要配饰在后续分镜中容易被引用；不要加入临时表情、动作、剧情事件、文字标签、编号、水印、Logo。',
    '保持角色自然中性表情和静态站姿，完整展示鞋子与服装细节。',
  ].join('\n')
}

function buildEnglishBasePrompt(characterRequest: string): string {
  return [
    'Generate one stylized character asset reference image for later storyboard image generation.',
    `User input, the only source for this character and style: ${characterRequest}`,
    'First internally derive a temporary character asset style guide from the user input. It must cover character identity and silhouette, background mood, lighting strategy, color palette, image filter, material texture, composition rules, and bans. If the user did not specify an item, infer it only from the semantics of the input. Do not reference the project Style Bible, do not inherit existing project style, and do not use a default white-background template.',
    'The output must be one complete image, not multiple files.',
    'Keep a multi-view character sheet layout: the left third is a frontal head-and-face identity close-up; the right two thirds show the same character as front full-body, side full-body, and back full-body views arranged horizontally, with consistent height, outfit, and body proportions.',
    'Do not use a pure white background. Apply the internally derived background, lighting, filter, color, material, and image texture directly in the image. The background must support asset style only; it must not lock the character to a specific story location or introduce fixed scene anchors that may pollute later storyboard shots.',
    'This image will later be used as a character reference asset for storyboard images, so the style must be stable, reusable, and inheritable by later shots. Do not generate a plain ID photo, white-background model sheet, or styleless modeling reference.',
    'Make the character identity, outfit, silhouette, hair, body type, and key accessories easy to reuse as storyboard references. Do not add temporary expressions, actions, plot events, text labels, numbers, watermarks, or logos.',
    'Keep a neutral expression and static standing posture. Show full shoes and costume details clearly.',
  ].join('\n')
}

export function buildCharacterStyleTestPrompt(input: {
  readonly characterRequest: string
  readonly locale: Locale
}): string {
  const characterRequest = normalizeCharacterRequest(input.characterRequest)
  return input.locale === 'en'
    ? buildEnglishBasePrompt(characterRequest)
    : buildChineseBasePrompt(characterRequest)
}
