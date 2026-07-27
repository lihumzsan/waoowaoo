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
    version: '1.1.0',
    title: '创作核心',
    summary: '所有专业创作工作的事实边界、目标忠实性、假设管理与交付自检。',
    tags: ['core', 'creative', 'reasoning', 'quality'],
  }),
  'story-development': defineSkill({
    id: 'story-development',
    version: '2.4.0',
    title: '故事与剧本开发',
    summary: '`outputKind=screenplay` 必须读取的唯一剧本创作 Skill，也是 `outputKind=chapter_plan` 的章节规划 Skill；不提取生产资产或第二套实体清单。',
    tags: ['story', 'script', 'screenplay', 'writing'],
  }),
  'continuity-memory': defineSkill({
    id: 'continuity-memory',
    version: '1.5.0',
    title: '连续性记忆',
    summary: '`outputKind=story_canon` 与 `outputKind=continuity_analysis` 必须读取：从原文提取稳定事实、剧情节拍与持续状态，并为可选 Chapter 边界提供连续性判断；它也拥有全系统唯一的语速与时长估算口径。',
    tags: ['continuity', 'canon', 'story', 'state', 'analysis', 'duration'],
  }),
  'director-core': defineSkill({
    id: 'director-core',
    version: '1.4.0',
    title: '导演与制作时间线核心',
    summary: '把剧情事实组织成镜头、分段、场面调度与音画时间线；`outputKind=video_prompt_set` 时必须与 `video-direction`、`quality-review` 一起读取。',
    tags: ['director', 'editing', 'timeline', 'shot', 'camera'],
  }),
  'creative-direction': defineSkill({
    id: 'creative-direction',
    version: '3.3.0',
    title: '创作方向',
    summary: '`outputKind=creative_direction` 必须读取：把用户意图与必要研究转译为视觉、叙事、导演、剪辑、声音和资产六个可执行方向块，可返回最终方向或 2–12 个完整候选。',
    tags: ['creative-direction', 'style', 'narrative', 'directing', 'editing', 'sound', 'assets'],
  }),
  'asset-development': defineSkill({
    id: 'asset-development',
    version: '2.3.0',
    title: '资产设计与生成提示词',
    summary: '`outputKind=asset_manifest` 的唯一资产范围与设计 Skill：在一个 Task 内从精确剧本筛选可复用生产资产、设计外观并生成最终 Prompt；不生图、不写项目。',
    tags: ['asset', 'image', 'character', 'location', 'prop', 'reference', 'candidate'],
  }),
  'video-direction': defineSkill({
    id: 'video-direction',
    version: '1.7.0',
    title: '视频导演与生成设计',
    summary: '`outputKind=video_prompt_set` 的核心 Skill；必须同时读取 `director-core` 与 `quality-review`，把全部适用知识内化为唯一最终提示词。',
    tags: ['video', 'director', 'prompt', 'continuity', 'audio'],
  }),
  'music-direction': defineSkill({
    id: 'music-direction',
    version: '1.4.0',
    title: '音乐与配乐设计',
    summary: '`outputKind=music_direction` 必须读取：从情绪诊断到整片连续配乐、配器、动态、留白和对白安全混音的设计方法。',
    tags: ['music', 'bgm', 'score', 'audio', 'emotion'],
  }),
  'quality-review': defineSkill({
    id: 'quality-review',
    version: '1.5.0',
    title: '创作质量审查',
    summary: '`outputKind=creative_review` 必须读取；`outputKind=video_prompt_set` 时必须与 `director-core`、`video-direction` 一起读取并在输出前自检。',
    tags: ['quality', 'review', 'continuity', 'validation', 'retry'],
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
