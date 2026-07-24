import {
  CREATIVE_SKILL_IDS,
  type CreativeSkillDefinition,
  type CreativeSkillId,
} from './types'

const RESOURCE_FILES = {
  zh: 'SKILL.zh.md',
  en: 'SKILL.en.md',
} as const

function defineSkill(
  definition: Omit<CreativeSkillDefinition, 'entryUri' | 'resources'>,
): CreativeSkillDefinition {
  return {
    ...definition,
    entryUri: `skill://${definition.id}/SKILL.md`,
    resources: RESOURCE_FILES,
  }
}

export const CREATIVE_SKILL_REGISTRY: Readonly<Record<CreativeSkillId, CreativeSkillDefinition>> = {
  'creative-core': defineSkill({
    id: 'creative-core',
    version: '1.0.0',
    title: { zh: '创作核心', en: 'Creative Core' },
    summary: {
      zh: '所有专业创作工作的事实边界、目标忠实性、假设管理与交付自检。',
      en: 'Fact boundaries, goal fidelity, assumption management, and delivery checks for all creative work.',
    },
    tags: ['core', 'creative', 'reasoning', 'quality'],
    keywords: {
      zh: ['通用', '创作', '事实', '假设', '目标', '自检', '质量', '专业工作'],
      en: ['general', 'creative', 'facts', 'assumptions', 'goal', 'self-check', 'quality'],
    },
  }),
  'story-development': defineSkill({
    id: 'story-development',
    version: '2.0.0',
    title: { zh: '故事与剧本开发', en: 'Story Development' },
    summary: {
      zh: '`outputKind=screenplay` 必须读取的唯一剧本创作 Skill，也是 `outputKind=chapter_plan` 的章节规划 Skill；不提取生产资产或第二套实体清单。',
      en: 'The sole screenwriting Skill required for `outputKind=screenplay`, and the chapter-planning Skill for `outputKind=chapter_plan`; it never extracts production assets or a second entity registry.',
    },
    tags: ['story', 'script', 'screenplay', 'intake', 'writing'],
    keywords: {
      zh: ['故事', '剧本', '编剧', '创意', '问诊', '扩写', '人物动机', '冲突', '结局', '时长', '章节规划', 'chapter_plan'],
      en: ['story', 'script', 'screenplay', 'writer', 'intake', 'runtime', 'motivation', 'conflict', 'ending', 'chapter planning', 'chapter_plan'],
    },
  }),
  'continuity-memory': defineSkill({
    id: 'continuity-memory',
    version: '1.1.0',
    title: { zh: '连续性记忆', en: 'Continuity Memory' },
    summary: {
      zh: '`outputKind=edit_bible_bundle` 与 `outputKind=continuity_analysis` 必须读取：从原文提取稳定事实、剧情节拍与持续状态，并为可选 Chapter 边界提供连续性判断。',
      en: 'Required for `outputKind=edit_bible_bundle` and `outputKind=continuity_analysis`: extract stable facts, beats, persistent state, and continuity judgments for optional Chapter boundaries.',
    },
    tags: ['continuity', 'bible', 'story', 'state', 'analysis'],
    keywords: {
      zh: ['连续性', '圣经', '设定', '角色', '地点', '节拍', '状态', '事件', '情绪', '时间线', '章节边界', 'chapter_plan'],
      en: ['continuity', 'bible', 'canon', 'character', 'location', 'beat', 'state', 'event', 'emotion', 'timeline', 'chapter boundary', 'chapter_plan'],
    },
  }),
  'director-core': defineSkill({
    id: 'director-core',
    version: '1.2.0',
    title: { zh: '导演与制作时间线核心', en: 'Director and Production Timeline Core' },
    summary: {
      zh: '把剧情事实组织成镜头、分段、场面调度与音画时间线；`outputKind=video_prompt_set` 时必须与 `video-direction`、`quality-review` 一起读取。',
      en: 'Direct shots, segments, blocking, and audiovisual timelines; for `outputKind=video_prompt_set`, this Skill must be read with `video-direction` and `quality-review`.',
    },
    tags: ['director', 'editing', 'timeline', 'shot', 'camera'],
    keywords: {
      zh: ['导演', '剪辑', '制作时间线', '镜头', '分镜', '景别', '运镜', '场面调度', '站位', '表演', '分段', '同期声'],
      en: ['director', 'editing', 'production timeline', 'shot', 'camera', 'blocking', 'staging', 'performance', 'segmentation', 'sync sound'],
    },
  }),
  'style-development': defineSkill({
    id: 'style-development',
    version: '1.2.0',
    title: { zh: '视觉风格开发', en: 'Visual Style Development' },
    summary: {
      zh: '`outputKind=style_bible` 必须读取：跨图片与视频共享的视觉风格、资产图灯光/材质、风格候选与灵感词汇；不拥有固定构图后缀。',
      en: 'Required for `outputKind=style_bible`: cross-media visual style, asset-image lighting and texture, style candidates, and inspiration vocabulary; fixed layout suffixes are excluded.',
    },
    tags: ['style', 'art-direction', 'palette', 'medium', 'preview'],
    keywords: {
      zh: ['视觉风格', '画风', '美术指导', '媒介', '质感', '色彩', '滤镜', '风格候选', '风格预览', '风格圣经'],
      en: ['visual style', 'art style', 'art direction', 'medium', 'finish', 'palette', 'filter', 'style candidate', 'style preview', 'style bible'],
    },
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    version: '2.0.0',
    title: { zh: '资产设计与生成提示词', en: 'Asset Development and Generation Prompts' },
    summary: {
      zh: '`outputKind=asset_manifest` 的唯一资产范围与设计 Skill：在一个 Task 内从精确剧本筛选可复用生产资产、提供原文证据、设计外观并生成最终 Prompt；不生图、不写项目。',
      en: 'The sole asset-scope and design Skill for `outputKind=asset_manifest`: select reusable production assets from an exact screenplay, ground them in source evidence, design appearances, and compose final prompts in one Task; never generate images or write the Project.',
    },
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
    keywords: {
      zh: ['资产', '图片', '生图提示词', '角色', '人物', '场景', '地点', '道具', '参考图', '候选', '资产修改'],
      en: ['asset', 'image prompt', 'character', 'location', 'scene', 'prop', 'reference image', 'candidate', 'asset modification'],
    },
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    version: '1.3.1',
    title: { zh: '视频导演与生成设计', en: 'Video Direction and Generation Design' },
    summary: {
      zh: '`outputKind=video_prompt_set` 的核心 Skill；必须同时读取 `director-core` 与 `quality-review`，把全部适用知识内化为唯一最终提示词。',
      en: 'Core Skill for `outputKind=video_prompt_set`; it must be read with `director-core` and `quality-review`, then internalize applicable knowledge into the sole final prompt.',
    },
    tags: ['video', 'director', 'prompt', 'continuity', 'audio'],
    keywords: {
      zh: ['视频', '导演', '提示词', '镜头', '参考图', '动作', '场面调度', '站位', '接缝', '连续性', '长视频', '对白', '声音'],
      en: ['video', 'director', 'prompt', 'shot', 'reference image', 'action', 'blocking', 'staging', 'seam', 'continuity', 'long video', 'dialogue', 'audio'],
    },
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    version: '1.1.0',
    title: { zh: '音乐与配乐设计', en: 'Music and Score Direction' },
    summary: {
      zh: '`outputKind=music_direction` 必须读取：从情绪诊断到整片连续配乐、配器、动态、留白和对白安全混音的设计方法。',
      en: 'Required for `outputKind=music_direction`: emotional diagnosis, continuous scoring, orchestration, dynamics, silence, and dialogue-safe mixes.',
    },
    tags: ['music', 'bgm', 'score', 'audio', 'emotion'],
    keywords: {
      zh: ['音乐', '配乐', '背景音乐', 'BGM', '情绪', '配器', '节奏', '动态', '混音', '对白'],
      en: ['music', 'bgm', 'score', 'underscore', 'emotion', 'orchestration', 'rhythm', 'dynamics', 'mix', 'dialogue'],
    },
  }),
  'quality-review': defineSkill({
    id: 'quality-review',
    version: '1.2.0',
    title: { zh: '创作质量审查', en: 'Creative Quality Review' },
    summary: {
      zh: '`outputKind=creative_review` 必须读取；`outputKind=video_prompt_set` 时必须与 `director-core`、`video-direction` 一起读取并在输出前自检。',
      en: 'Required for `outputKind=creative_review`; for `outputKind=video_prompt_set`, it must be read with `director-core` and `video-direction` for pre-output self-review.',
    },
    tags: ['quality', 'review', 'continuity', 'validation', 'retry'],
    keywords: {
      zh: ['质量', '审查', '检查', '验收', '站位', '接缝', '连续性', '返工', '修正', '重试', '成片'],
      en: ['quality', 'review', 'check', 'validation', 'blocking', 'seam', 'continuity', 'rework', 'correction', 'retry', 'final'],
    },
  }),
}

export const CREATIVE_SKILLS: readonly CreativeSkillDefinition[] = CREATIVE_SKILL_IDS.map(
  (skillId) => CREATIVE_SKILL_REGISTRY[skillId],
)

export function getCreativeSkillDefinition(skillId: CreativeSkillId): CreativeSkillDefinition {
  const definition = CREATIVE_SKILL_REGISTRY[skillId]
  if (!definition) {
    throw new Error(`CREATIVE_SKILL_NOT_FOUND:${skillId}`)
  }
  return definition
}
