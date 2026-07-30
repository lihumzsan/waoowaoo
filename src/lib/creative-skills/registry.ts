import {
  CREATIVE_SKILL_IDS,
  type CreativeSkillDefinition,
  type CreativeSkillId,
} from './types'

function defineSkill(
  definition: Omit<CreativeSkillDefinition, 'entryUri'>,
): CreativeSkillDefinition {
  return {
    ...definition,
    entryUri: `skill://${definition.id}/SKILL.md`,
  }
}

export const CREATIVE_SKILL_REGISTRY: Readonly<Record<CreativeSkillId, CreativeSkillDefinition>> = {
  'creative-core': defineSkill({
    id: 'creative-core',
    version: '1.3.0',
    title: '创作核心',
    summary: '所有专业创作工作的事实边界、目标忠实性、假设管理、剧本时间线纪律、通用时长估算与交付自检；由 Worker 自动预加载。',
    tags: ['core', 'creative', 'reasoning', 'quality', 'duration'],
  }),
  'story-development': defineSkill({
    id: 'story-development',
    version: '3.0.0',
    title: '故事与剧本开发',
    summary: '`outputKind=screenplay` 必须读取的唯一剧本创作 Skill；只创作或修改剧本，不规划 Chapter、不提取 Canon、不登记生产资产。',
    tags: ['story', 'script', 'screenplay', 'writing'],
  }),
  'chapter-continuity-planning': defineSkill({
    id: 'chapter-continuity-planning',
    version: '1.0.0',
    title: '跨 Chapter 连续性规划',
    summary: '`outputKind=chapter_continuity_plan` 必须读取：从一个精确剧本同时产出全局 Story Canon 与至少两个 Chapter 的连续性边界；不设计镜头、视频提示词或成片审计。',
    tags: ['chapter', 'continuity', 'canon', 'story', 'state', 'planning'],
  }),
  'creative-direction': defineSkill({
    id: 'creative-direction',
    version: '4.3.0',
    title: '创作方向',
    summary: '`outputKind=creative_direction` 必须读取：把用户意图与必要研究收敛为一份只决定呈现、不改写剧本内容或时间线的六领域方向。',
    tags: ['creative-direction', 'style', 'narrative', 'directing', 'editing', 'sound', 'assets'],
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    version: '3.0.0',
    title: '资产范围与视觉设计',
    summary: '`outputKind=asset_manifest` 的唯一资产范围与设计 Skill：从精确剧本筛选可复用生产资产并记录稳定可见设计；不编写最终媒体 Prompt、不生图、不写项目。',
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    version: '2.1.0',
    title: '视频导演与生成设计',
    summary: '`outputKind=video_prompt_set` 的唯一专业 Skill：先从剧本派生整片时间线，再完成导演规划、分段装载、最终提示词与输出前自检。',
    tags: ['video', 'director', 'prompt', 'editing', 'timeline', 'shot', 'camera', 'continuity', 'audio'],
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    version: '1.5.0',
    title: '音乐与配乐设计',
    summary: '`outputKind=music_direction` 必须读取：从情绪诊断到整片连续配乐、配器、动态、留白和对白安全混音的设计方法。',
    tags: ['music', 'bgm', 'score', 'audio', 'emotion'],
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
