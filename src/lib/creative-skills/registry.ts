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
    instructionAppendix: null,
    version: '1.5.0',
    title: '创作核心',
    summary: '主 Agent 专业创作共用的事实边界、目标忠实性、假设管理、续作状态锚定、剧本时间线纪律、通用时长估算与交付自检。',
    tags: ['core', 'creative', 'reasoning', 'quality', 'duration', 'continuity'],
  }),
  'story-development': defineSkill({
    id: 'story-development',
    instructionAppendix: null,
    version: '5.0.0',
    title: '故事与剧本开发',
    summary: '忠实且真正好看的剧本创作方法：人物因果、节奏档位、开场与对白纪律；只处理故事文本，不登记生产资产。',
    tags: ['story', 'script', 'screenplay', 'writing', 'hook', 'pacing'],
  }),
  'creative-direction': defineSkill({
    id: 'creative-direction',
    instructionAppendix: null,
    version: '5.0.1',
    title: '创作方向',
    summary: '把用户意图与必要研究收敛为一份只决定呈现、不改写剧本内容或时间线的六领域方向。',
    tags: ['creative-direction', 'style', 'narrative', 'directing', 'editing', 'sound', 'assets'],
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    instructionAppendix: null,
    version: '5.2.0',
    title: '资产范围与视觉设计',
    summary: '从精确剧本筛选可复用资产，完成稳定设计与最终图片提示词；生成画幅由服务端资产策略决定。',
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    instructionAppendix: 'h3-prompt-grammar',
    version: '4.6.1',
    title: '视频导演与生成设计',
    summary: '把客户效果要求转成来源有据的导演设计，按人物已选音色和 H3 结构构造和修订最终提示词、参考关系与时间线。',
    tags: ['video', 'director', 'prompt', 'editing', 'timeline', 'shot', 'camera', 'continuity', 'audio'],
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    instructionAppendix: null,
    version: '3.2.0',
    title: '音乐与声音设计',
    summary: '按目标创作配乐、环境音或已确认人物的音色试听；人物音色默认完成声音描述与试听台词，供用户比较、修改和采用。',
    tags: ['music', 'bgm', 'score', 'audio', 'voice', 'composition-plan', 'timeline'],
  }),
}

export function getCreativeSkillDefinition(skillId: CreativeSkillId): CreativeSkillDefinition {
  const definition = CREATIVE_SKILL_REGISTRY[skillId]
  if (!definition) {
    throw new Error(`CREATIVE_SKILL_NOT_FOUND:${skillId}`)
  }
  return definition
}
