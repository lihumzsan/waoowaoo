import type { Locale } from '@/i18n/routing'
import { CHARACTER_ASSET_IMAGE_RATIO } from '@/lib/constants'

export const CHARACTER_STYLE_TEST_ASPECT_RATIO = CHARACTER_ASSET_IMAGE_RATIO

function normalizeCharacterRequest(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function buildChineseStyleExpansion(characterRequest: string): string {
  return [
    '本次角色资产风格规范（必须显性执行，不要只在脑中概括）：',
    `- 风格核心：以“${characterRequest}”的身份语义为唯一来源，扩写成强风格化的电影概念设定，而不是普通职业/身份展示。`,
    '- 短输入规则：如果用户只输入一个身份或名词，也必须主动选择鲜明、统一、可继承的视觉方向；不要因为信息少就生成中性白底、普通棚拍或无风格设定图。',
    '- 风格来源边界：不要引用项目 Style Bible，不要继承项目既有风格，不要套用历史资产风格；只能使用本次用户输入及其语义推导。',
    '- 背景氛围：使用抽象、符号化、非剧情地点的风格背景，让观众一眼能感到角色所属气质；背景必须有颜色、光影、纹理和空气感。',
    '- 灯光策略：使用有辨识度的主光、轮廓光或环境光，不要使用平光；光线要强化脸部、服装褶皱、材质和剪影。',
    '- 色彩与滤镜：选择明确的主色、辅色和整体滤镜，例如低饱和、胶片颗粒、雾化高光、墨色层次、冷暖对比或其他从输入语义推导出的风格效果。',
    '- 材质质感：强化服装面料、皮肤、配饰、背景表面的触感；不能只有干净线稿或默认 3D 建模质感。',
    '- 外观自由度：用户没有明确写死的发色、配饰、服装细节、年龄感和材质细节，可以由 AI 根据身份语义合理设计；只选择少量稳定、可复用、容易被分镜继承的识别锚点，不要堆满随机细节。',
    '- 角色扩展语境：根据角色身份自动推导 2 到 4 个代表性动作、姿态或工作/生活语境，例如武僧可以练武或持棍静立，模特可以走台步，程序员可以在深夜工位前站立或倚桌思考；这些扩展必须服务角色识别和风格继承，而不是讲具体剧情。',
    '- 构图规则：整张图像像一张完整角色资产板，基础身份区与扩展语境区共享同一风格、灯光、滤镜、色彩和材质逻辑；版式可以根据角色语义灵活组织，不要做成四张孤立证件照。',
    '- 禁止项：纯白底、灰白渐变底、普通证件照、无风格三视图、默认棚拍、不可继承的临时剧情事件、第二个人物、文字标签、编号、水印、Logo。',
  ].join('\n')
}

function buildEnglishStyleExpansion(characterRequest: string): string {
  return [
    'Temporary character asset style guide, visibly apply it rather than only thinking about it:',
    `- Style core: use the identity semantics of "${characterRequest}" as the only source, and expand it into a strongly stylized cinematic concept design, not a plain occupation or identity display.`,
    '- Short-input rule: if the user only entered one identity or noun, still choose a vivid, unified, inheritable visual direction. Do not produce a neutral white-background sheet, plain studio render, or styleless reference just because the input is sparse.',
    '- Style source boundary: do not reference the project Style Bible, do not inherit existing project style, and do not reuse historical asset style. Use only this user input and semantic inference from it.',
    '- Background mood: use an abstract, symbolic, non-story-location style background that immediately communicates the character aura. The background must have color, light, texture, and atmosphere.',
    '- Lighting strategy: use distinctive key light, rim light, or ambient light, not flat lighting. The lighting must strengthen the face, fabric folds, material surfaces, and silhouette.',
    '- Color and filter: choose a clear main color, secondary color, and overall image filter, such as low saturation, film grain, hazed highlights, ink-like tonal layers, warm-cool contrast, or another style effect inferred from the input semantics.',
    '- Material texture: emphasize costume fabric, skin, accessories, and background surface tactility. Do not use only clean line art or a default 3D modeling look.',
    '- Appearance freedom: hair color, accessories, outfit details, perceived age, and material details that the user did not explicitly lock may be reasonably designed by AI from the identity semantics. Choose only a few stable, reusable recognition anchors that later storyboard images can inherit; do not pile on random details.',
    '- Character context expansion: infer 2 to 4 representative actions, poses, or work/life contexts from the character identity. For example, a martial monk may train or stand with a staff, a fashion model may walk a runway, and a programmer may stand by a late-night workstation or lean on a desk thinking. These expansions must support character recognition and style inheritance, not tell a specific plot event.',
    '- Composition rule: the image must read as one complete character asset board. The foundation identity area and contextual expansion area share one style, lighting, filter, palette, and material logic. The layout may adapt to the character semantics; do not make four isolated ID photos.',
    '- Bans: pure white background, gray-white gradient background, plain ID photo, styleless three-view sheet, default studio render, non-inheritable temporary plot event, second character, text labels, numbers, watermark, Logo.',
  ].join('\n')
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
    buildChineseStyleExpansion(characterRequest),
    '画面必须保持单张完整图片，不要拆成多张输出。',
    '版式不再固定死为白底三视图，但必须同时包含两类内容：基础身份区 + 扩展语境区。基础身份区必须包含角色大头正面身份特写，以及同一角色的正面全身、侧面全身、背面全身三视图；三视图服装、体型、发型和主要识别锚点必须一致。',
    '扩展语境区必须根据本次角色特征自由生成 2 到 4 个小画面或姿态样本：可以包含代表性动作、职业姿态、工作/生活场景、道具使用方式、环境光影或角色气质瞬间。扩展内容要像电影角色设定板，而不是剧情分镜；只能出现同一个角色。',
    '资产图不能使用纯白底。必须把上面的背景、灯光、滤镜、色彩、材质和画面质感落实到画面里；背景只能服务于资产风格，不得绑定具体剧情地点，不得出现可误导分镜的固定场景锚点。',
    '这张图后续会被分镜图片当作人物参考资产，因此风格必须稳定、可复用、能被后续镜头继承；不要生成普通证件照、白底三视图或无风格的建模参考图。',
    '让角色外观、服装、轮廓、发型、体型、主要配饰和扩展动作样本在后续分镜中容易被引用。用户没有明确指定的外观细节不要机械写死，允许 AI 选择最符合身份语义的少量稳定设计。',
    '基础三视图区保持自然中性表情和静态站姿，完整展示鞋子与服装细节；扩展语境区可以出现符合角色身份的动作、站姿或工作状态，但不要加入第二个人物、具体剧情事件、文字标签、编号、水印、Logo。',
  ].join('\n')
}

function buildEnglishBasePrompt(characterRequest: string): string {
  return [
    'Generate one stylized character asset reference image for later storyboard image generation.',
    `User input, the only source for this character and style: ${characterRequest}`,
    buildEnglishStyleExpansion(characterRequest),
    'The output must be one complete image, not multiple files.',
    'The layout is no longer locked to a plain white-background three-view sheet, but it must contain two content groups: a foundation identity area and a contextual expansion area. The foundation identity area must include a frontal head-and-face identity close-up plus front full-body, side full-body, and back full-body views of the same character; outfit, body proportions, hairstyle, and major recognition anchors must remain consistent.',
    'The contextual expansion area must freely generate 2 to 4 small panels or pose samples inferred from this character identity: representative actions, occupational poses, work/life context, prop usage, environmental lighting, or character aura moments are allowed. The expansions should read as a cinematic character design board, not a plot storyboard, and only the same character may appear.',
    'Do not use a pure white background. Apply the background, lighting, filter, color, material, and image texture from the guide above directly in the image. The background must support asset style only; it must not lock the character to a specific story location or introduce fixed scene anchors that may pollute later storyboard shots.',
    'This image will later be used as a character reference asset for storyboard images, so the style must be stable, reusable, and inheritable by later shots. Do not generate a plain ID photo, white-background model sheet, or styleless modeling reference.',
    'Make the character identity, outfit, silhouette, hair, body type, key accessories, and contextual action samples easy to reuse as storyboard references. Do not mechanically lock appearance details that the user did not specify; allow AI to choose a few stable designs that best fit the identity semantics.',
    'In the foundation three-view area, keep a neutral expression and static standing posture, and show full shoes and costume details clearly. In the contextual expansion area, identity-appropriate actions, standing poses, or work states are allowed, but do not add a second character, a specific plot event, text labels, numbers, watermarks, or logos.',
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
