import {
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
    version: '1.5.0',
    title: '创作核心',
    summary: '主 Agent 专业创作共用的事实边界、目标忠实性、假设管理、续作状态锚定、剧本时间线纪律、通用时长估算与交付自检。',
    tags: ['core', 'creative', 'reasoning', 'quality', 'duration', 'continuity'],
  }),
  'story-development': defineSkill({
    id: 'story-development',
    version: '5.0.0',
    title: '故事与剧本开发',
    summary: '忠实且真正好看的剧本创作方法：人物因果、节奏档位、开场与对白纪律；只处理故事文本，不登记生产资产。',
    tags: ['story', 'script', 'screenplay', 'writing', 'hook', 'pacing'],
  }),
  'creative-direction': defineSkill({
    id: 'creative-direction',
    version: '5.0.1',
    title: '创作方向',
    summary: '把用户意图与必要研究收敛为一份只决定呈现、不改写剧本内容或时间线的六领域方向。',
    tags: ['creative-direction', 'style', 'narrative', 'directing', 'editing', 'sound', 'assets'],
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    version: '5.2.0',
    title: '资产范围与视觉设计',
    summary: '从精确剧本筛选可复用资产，完成稳定设计与最终图片提示词；生成画幅由服务端资产策略决定。',
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    version: '4.3.0',
    title: '视频导演与生成设计',
    summary: '以结构化状态接力和物理表演设计完成整片时间线、最少分段装载、最终提示词与接缝自检。',
    tags: ['video', 'director', 'prompt', 'editing', 'timeline', 'shot', 'camera', 'continuity', 'audio'],
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    version: '2.2.0',
    title: '音乐与配乐设计',
    summary: '从情绪诊断到整片连续配乐、配器、动态、留白和对白安全混音的设计方法。',
    tags: ['music', 'bgm', 'score', 'audio', 'emotion'],
  }),
}

export function getCreativeSkillDefinition(skillId: CreativeSkillId): CreativeSkillDefinition {
  const definition = CREATIVE_SKILL_REGISTRY[skillId]
  if (!definition) {
    throw new Error(`CREATIVE_SKILL_NOT_FOUND:${skillId}`)
  }
  return definition
}
