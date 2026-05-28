import type { Locale } from '@/i18n/routing'

export type PromptSuffixVariantId =
  | 'current_full'
  | 'compact_style'
  | 'visual_quality'
  | 'negative_only'
  | 'no_suffix'

export interface PromptSuffixVariant {
  readonly id: PromptSuffixVariantId
  readonly title: Record<Locale, string>
  readonly description: Record<Locale, string>
  readonly suffix: Record<Locale, string>
}

export const PROMPT_SUFFIX_TEST_VARIANTS: readonly PromptSuffixVariant[] = [
  {
    id: 'current_full',
    title: {
      zh: '当前完整后缀',
      en: 'Current Full Suffix',
    },
    description: {
      zh: '模拟当前 Style Bible 固定追加结构，信息最完整，也最长。',
      en: 'Mirrors the current fixed Style Bible append structure. Most complete and longest.',
    },
    suffix: {
      zh: [
        '系统 Style Bible 视觉要求（固定追加，必须遵守）：',
        '用途：分镜图生成。将这些视觉与镜头规则应用到整张画面。',
        '画面滤镜：自然电影质感，真实摄影曝光，低饱和温润影调，轻微空气透视，克制高光。',
        '光线：遵循画面中已有光源方向，使用自然漫射光或柔和侧光，保留真实阴影层次。',
        '色彩：避免过度鲜艳，保留场景固有材质色，整体低饱和、自然、统一。',
        '构图：保持单张电影分镜图，前景/中景/背景清晰，留白克制，主体关系明确。',
        '负向约束：禁止文字，禁止字幕，禁止编号，禁止水印，禁止logo，禁止拼图，禁止多格漫画。',
        '硬禁用项：禁止过度锐化，禁止HDR感，禁止塑料皮肤，禁止AI数码壁纸感。',
        '运镜：静帧分镜只体现机位和构图，不要表现成连续运动轨迹。',
        '镜头与景深：35mm电影镜头质感，自然景深，背景按镜头需要轻微虚化。',
      ].join('\n'),
      en: [
        'System Style Bible requirements, fixed append, must follow:',
        'Usage: storyboard image generation. Apply these visual and camera rules to the whole frame.',
        'Image filter: natural cinematic realism, photographic exposure, low-saturation warm tones, slight aerial perspective, restrained highlights.',
        'Lighting: follow existing light direction in the frame, use natural diffused light or soft side light, preserve realistic shadow layers.',
        'Color: avoid excessive saturation, preserve material colors, keep the palette natural and unified.',
        'Composition: keep one cinematic storyboard image with clear foreground, midground, background, restrained negative space, and clear subject relations.',
        'Negative constraints: no text, no subtitles, no numbering, no watermark, no logo, no collage, no multi-panel comic.',
        'Hard bans: no oversharpening, no HDR look, no plastic skin, no AI wallpaper look.',
        'Camera movement: as a still storyboard frame, express camera placement and composition only, not motion trails.',
        'Lens and depth: 35mm cinematic lens feel, natural depth of field, softly defocused background when needed.',
      ].join('\n'),
    },
  },
  {
    id: 'compact_style',
    title: {
      zh: '压缩风格后缀',
      en: 'Compact Style Suffix',
    },
    description: {
      zh: '保留风格、光线、构图和负向约束，但去掉字段式结构。',
      en: 'Keeps style, light, composition, and bans while removing field-like structure.',
    },
    suffix: {
      zh: '自然电影写实质感，真实摄影曝光，低饱和统一色调，柔和但有方向的光线，材质保持真实，前景/中景/背景层次清楚，构图克制。禁止文字、字幕、编号、水印、logo、拼图、多格漫画、过度锐化、HDR感、塑料皮肤和AI壁纸感。',
      en: 'Natural cinematic realism, photographic exposure, unified low-saturation color, soft but directional light, realistic materials, clear foreground/midground/background layers, restrained composition. No text, subtitles, numbering, watermark, logo, collage, multi-panel comic, oversharpening, HDR look, plastic skin, or AI wallpaper look.',
    },
  },
  {
    id: 'visual_quality',
    title: {
      zh: '画质控制后缀',
      en: 'Visual Quality Suffix',
    },
    description: {
      zh: '只控制真实摄影质感和常见坏味道，尽量不干预镜头内容。',
      en: 'Controls photographic quality and common artifacts with minimal content interference.',
    },
    suffix: {
      zh: '真实摄影质感，自然曝光，边缘不过度锐化，暗部有层次和轻微颗粒，皮肤与材质不过度平滑，画面干净但不塑料。禁止文字、字幕、水印、logo。',
      en: 'Photographic realism, natural exposure, no oversharpened edges, layered shadows with subtle grain, no overly smoothed skin or materials, clean but not plastic. No text, subtitles, watermark, or logo.',
    },
  },
  {
    id: 'negative_only',
    title: {
      zh: '仅负向约束',
      en: 'Negative Only',
    },
    description: {
      zh: '只保留必须禁止项，用来观察主体提示词自身的表现。',
      en: 'Keeps only required bans to observe the base prompt by itself.',
    },
    suffix: {
      zh: '禁止文字，禁止字幕，禁止编号，禁止水印，禁止logo，禁止拼图，禁止多格漫画。',
      en: 'No text, no subtitles, no numbering, no watermark, no logo, no collage, no multi-panel comic.',
    },
  },
  {
    id: 'no_suffix',
    title: {
      zh: '无后缀',
      en: 'No Suffix',
    },
    description: {
      zh: '完全不追加后缀，作为对照组。',
      en: 'Appends nothing. This is the control group.',
    },
    suffix: {
      zh: '',
      en: '',
    },
  },
]

export function getPromptSuffixVariant(id: string): PromptSuffixVariant | null {
  return PROMPT_SUFFIX_TEST_VARIANTS.find((variant) => variant.id === id) ?? null
}

export function buildPromptSuffixTestPrompt(input: {
  readonly basePrompt: string
  readonly suffix: string
}): string {
  const basePrompt = input.basePrompt.trim()
  const suffix = input.suffix.trim()
  if (!basePrompt) throw new Error('PROMPT_SUFFIX_TEST_BASE_PROMPT_REQUIRED')
  return suffix ? `${basePrompt}\n\n${suffix}` : basePrompt
}
