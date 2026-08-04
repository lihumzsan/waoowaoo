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
    version: '1.4.0',
    title: '创作核心',
    summary: '固定专业子 Agent共享的事实边界、目标忠实性、假设管理、剧本时间线纪律、通用时长估算与交付自检。',
    tags: ['core', 'creative', 'reasoning', 'quality', 'duration'],
  }),
  'story-development': defineSkill({
    id: 'story-development',
    version: '3.1.0',
    title: '故事与剧本开发',
    summary: '剧本创作与修改方法；只处理故事和剧本文本，不登记生产资产。',
    tags: ['story', 'script', 'screenplay', 'writing'],
  }),
  'long-form-production': defineSkill({
    id: 'long-form-production',
    version: '1.1.0',
    title: '长篇连续制作',
    summary: '把长篇作品组织成可并行、可续跑的普通目录与连续性文档，并用 Production Manifest 批量提交媒体。',
    tags: ['long-form', 'series', 'continuity', 'production', 'batch', 'planning'],
  }),
  'creative-direction': defineSkill({
    id: 'creative-direction',
    version: '4.4.0',
    title: '创作方向',
    summary: '把用户意图与必要研究收敛为一份只决定呈现、不改写剧本内容或时间线的六领域方向。',
    tags: ['creative-direction', 'style', 'narrative', 'directing', 'editing', 'sound', 'assets'],
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    version: '4.0.0',
    title: '资产范围与视觉设计',
    summary: '从精确剧本筛选可复用资产，完成稳定设计、最终图片提示词与显式 4:3 Production Manifest；不执行媒体生产。',
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    version: '2.3.0',
    title: '视频导演与生成设计',
    summary: '先从剧本派生整片时间线，再完成导演规划、分段装载、最终提示词与输出前自检。',
    tags: ['video', 'director', 'prompt', 'editing', 'timeline', 'shot', 'camera', 'continuity', 'audio'],
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    version: '1.6.0',
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
