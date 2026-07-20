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
    version: '1.0.0',
    title: { zh: '故事与剧本开发', en: 'Story Development' },
    summary: {
      zh: '从创意问诊、关键方向收敛到时长受控、完整可拍摄剧本的创作方法。',
      en: 'Methods for creative intake, high-impact direction setting, runtime control, and complete filmable scripts.',
    },
    tags: ['story', 'script', 'screenplay', 'intake', 'writing'],
    keywords: {
      zh: ['故事', '剧本', '编剧', '创意', '问诊', '扩写', '人物动机', '冲突', '结局', '时长'],
      en: ['story', 'script', 'screenplay', 'writer', 'intake', 'runtime', 'motivation', 'conflict', 'ending'],
    },
  }),
  'continuity-memory': defineSkill({
    id: 'continuity-memory',
    version: '1.0.0',
    title: { zh: '连续性记忆', en: 'Continuity Memory' },
    summary: {
      zh: '从原文提取稳定事实、剧情节拍、持续状态变化与情绪区间的方法。',
      en: 'Methods for extracting stable facts, narrative beats, persistent state changes, and emotional regions.',
    },
    tags: ['continuity', 'bible', 'story', 'state', 'analysis'],
    keywords: {
      zh: ['连续性', '圣经', '设定', '角色', '地点', '节拍', '状态', '事件', '情绪', '时间线'],
      en: ['continuity', 'bible', 'canon', 'character', 'location', 'beat', 'state', 'event', 'emotion', 'timeline'],
    },
  }),
  'director-core': defineSkill({
    id: 'director-core',
    version: '1.1.0',
    title: { zh: '导演与制作时间线核心', en: 'Director and Production Timeline Core' },
    summary: {
      zh: '把剧情事实组织成镜头、生成分段、表演、景别、运镜与同期声的统一导演方法。',
      en: 'Unified directing methods for shots, generation segments, performance, shot scale, camera motion, and sync sound.',
    },
    tags: ['director', 'editing', 'timeline', 'shot', 'camera'],
    keywords: {
      zh: ['导演', '剪辑', '制作时间线', '镜头', '分镜', '景别', '运镜', '表演', '分段', '同期声'],
      en: ['director', 'editing', 'production timeline', 'shot', 'camera', 'performance', 'segmentation', 'sync sound'],
    },
  }),
  'style-development': defineSkill({
    id: 'style-development',
    version: '1.0.0',
    title: { zh: '视觉风格开发', en: 'Visual Style Development' },
    summary: {
      zh: '跨图片与视频共享的视觉风格、资产图专用画面规则、风格候选与预览设计方法。',
      en: 'Methods for cross-media visual style, asset-image-specific presentation rules, style candidates, and previews.',
    },
    tags: ['style', 'art-direction', 'palette', 'medium', 'preview'],
    keywords: {
      zh: ['视觉风格', '画风', '美术指导', '媒介', '质感', '色彩', '滤镜', '风格候选', '风格预览', '风格圣经'],
      en: ['visual style', 'art style', 'art direction', 'medium', 'finish', 'palette', 'filter', 'style candidate', 'style preview', 'style bible'],
    },
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    version: '1.0.0',
    title: { zh: '资产设计与生成提示词', en: 'Asset Development and Generation Prompts' },
    summary: {
      zh: '角色、场景、道具、参考图、候选资产与已有资产修改的设计方法。',
      en: 'Methods for characters, locations, props, reference images, asset candidates, and existing-asset modifications.',
    },
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
    keywords: {
      zh: ['资产', '图片', '生图提示词', '角色', '人物', '场景', '地点', '道具', '参考图', '候选', '资产修改'],
      en: ['asset', 'image prompt', 'character', 'location', 'scene', 'prop', 'reference image', 'candidate', 'asset modification'],
    },
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    version: '1.1.0',
    title: { zh: '视频导演与生成设计', en: 'Video Direction and Generation Design' },
    summary: {
      zh: '把视频参考、导演设计、条件式转场、对白和原生同步声内化为唯一最终提示词。',
      en: 'Internalize video references, directing, motivated transitions, dialogue, and native synchronized sound into one final prompt.',
    },
    tags: ['video', 'director', 'prompt', 'continuity', 'audio'],
    keywords: {
      zh: ['视频', '导演', '提示词', '镜头', '参考图', '动作', '连续性', '长视频', '对白', '声音'],
      en: ['video', 'director', 'prompt', 'shot', 'reference image', 'action', 'continuity', 'long video', 'dialogue', 'audio'],
    },
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    version: '1.0.0',
    title: { zh: '音乐与配乐设计', en: 'Music and Score Direction' },
    summary: {
      zh: '从情绪诊断到整片连续配乐、配器、动态、留白和对白安全混音的设计方法。',
      en: 'Methods for emotional diagnosis, continuous scoring, orchestration, dynamics, silence, and dialogue-safe mixes.',
    },
    tags: ['music', 'bgm', 'score', 'audio', 'emotion'],
    keywords: {
      zh: ['音乐', '配乐', '背景音乐', 'BGM', '情绪', '配器', '节奏', '动态', '混音', '对白'],
      en: ['music', 'bgm', 'score', 'underscore', 'emotion', 'orchestration', 'rhythm', 'dynamics', 'mix', 'dialogue'],
    },
  }),
  'quality-review': defineSkill({
    id: 'quality-review',
    version: '1.0.0',
    title: { zh: '创作质量审查', en: 'Creative Quality Review' },
    summary: {
      zh: '对故事、视觉、视频、连续性和声音进行基于证据的检查与最小范围返工。',
      en: 'Evidence-based review and minimum-scope correction for story, visuals, video, continuity, and audio.',
    },
    tags: ['quality', 'review', 'continuity', 'validation', 'retry'],
    keywords: {
      zh: ['质量', '审查', '检查', '验收', '连续性', '返工', '修正', '重试', '成片'],
      en: ['quality', 'review', 'check', 'validation', 'continuity', 'rework', 'correction', 'retry', 'final'],
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
