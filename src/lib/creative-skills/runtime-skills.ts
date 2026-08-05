import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readCreativeSkillResource } from './loader'
import {
  CREATIVE_WORKER_OUTPUT_KIND,
  creativeOutputJsonSchema,
  readCreativeOutputDefinition,
} from './output-registry'
import { getCreativeSkillDefinition } from './registry'
import type { CreativeOutputKind, CreativeSkillId, CreativeWorkerKind } from './types'

type ProfessionalSkillId = Exclude<CreativeSkillId, 'creative-core'>

export type CreativeRuntimeSkillDefinition = {
  readonly kind: CreativeWorkerKind
  readonly title: string
  readonly description: string
  readonly skillIds: readonly ['creative-core', ProfessionalSkillId]
  readonly outputKind: CreativeOutputKind
  readonly executionFacts: string | null
}

function defineRuntimeSkill(
  definition: Omit<CreativeRuntimeSkillDefinition, 'outputKind'>,
): CreativeRuntimeSkillDefinition {
  return {
    ...definition,
    outputKind: CREATIVE_WORKER_OUTPUT_KIND[definition.kind],
  }
}

export const CREATIVE_RUNTIME_SKILL_REGISTRY: Readonly<
  Record<CreativeWorkerKind, CreativeRuntimeSkillDefinition>
> = {
  story: defineRuntimeSkill({
    kind: 'story',
    title: '故事与剧本开发',
    description: '创作或修改故事与剧本，并形成 screenplay 专业结果。',
    skillIds: ['creative-core', 'story-development'],
    executionFacts: null,
  }),
  long_form: defineRuntimeSkill({
    kind: 'long_form',
    title: '长篇连续制作',
    description: '组织长篇目录、连续性事实与生产单元，并形成 long_form_plan 专业结果。',
    skillIds: ['creative-core', 'long-form-production'],
    executionFacts: 'Point to results owned by other professional domains; never author their prompts.',
  }),
  direction: defineRuntimeSkill({
    kind: 'direction',
    title: '创作方向',
    description: '建立项目级呈现方向，并形成 creative_direction 专业结果。',
    skillIds: ['creative-core', 'creative-direction'],
    executionFacts: null,
  }),
  assets: defineRuntimeSkill({
    kind: 'assets',
    title: '资产范围与视觉设计',
    description: '筛选和设计生产资产，形成带最终图片提示词的 asset_generation_batch 专业结果。',
    skillIds: ['creative-core', 'asset-development'],
    executionFacts: 'Every asset must include its stable creative identity, complete final prompt, explicit generation parameters, and user-visible name. The server owns Resource placement.',
  }),
  video: defineRuntimeSkill({
    kind: 'video',
    title: '视频导演与生成设计',
    description: '完成视频导演、分段和最终视频提示词，形成 video_generation_batch 专业结果。',
    skillIds: ['creative-core', 'video-direction'],
    executionFacts: 'Use only the non-null productionCapabilities.video facts injected by the Wao system. Never guess capability limits.',
  }),
  music: defineRuntimeSkill({
    kind: 'music',
    title: '音乐与配乐设计',
    description: '完成音乐设计和最终音乐提示词，形成 audio_generation_batch 专业结果。',
    skillIds: ['creative-core', 'music-direction'],
    executionFacts: 'Use only the non-null productionCapabilities.music facts injected by the Wao system. Never guess capability limits.',
  }),
}

export const CREATIVE_RUNTIME_SKILLS: readonly CreativeRuntimeSkillDefinition[] = Object.values(
  CREATIVE_RUNTIME_SKILL_REGISTRY,
)

/** Pinned Codex system Skills stay disabled. A Codex upgrade that adds one fails smoke. */
export const PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS = [
  'imagegen',
  'openai-docs',
  'plugin-creator',
  'review-agent',
  'skill-creator',
  'skill-installer',
] as const

export const PRIMARY_AGENT_GLOBAL_INSTRUCTIONS = `# Wao orchestration

- Codex agents are disabled. Complete the current request in the primary Agent; never spawn, delegate to, wait for, or coordinate another Agent.
- Before professional creative work, read exactly one matching Wao domain Skill from the native Skill inventory. Its embedded core method, domain method, outputKind, and strict schema are one complete contract; do not combine multiple Wao domain Skills unless the user explicitly requests multiple professional deliverables.
- The primary Agent is the sole writer of each professional result. Construct one strict object internally, then use that same object for the requested response, explicit document save, or media submission. Do not create a parallel rewrite or ask another writer to repair it.
- For asset_generation_batch, video_generation_batch, or audio_generation_batch with actual items, pass those exact items to create_image, create_video, or create_audio. If validation rejects a field, correct the same in-turn object before resubmitting.
- Runtime scratch is never a project Resource. Save a document only when the user explicitly requests persistence.`

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function withoutFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/u, '')
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u)
  if (!match) throw new Error('CREATIVE_SKILL_FRONTMATTER_REQUIRED')
  return normalized.slice(match[0].length).trim()
}

async function buildRuntimeSkill(skill: CreativeRuntimeSkillDefinition): Promise<string> {
  const outputDefinition = readCreativeOutputDefinition(skill.outputKind)
  if (
    outputDefinition.workerKind !== skill.kind
    || outputDefinition.professionalSkillId !== skill.skillIds[1]
  ) {
    throw new Error(`CREATIVE_RUNTIME_SKILL_OUTPUT_REGISTRY_MISMATCH:${skill.kind}`)
  }
  const resources = await Promise.all(skill.skillIds.map(async (skillId) => {
    const definition = getCreativeSkillDefinition(skillId)
    const resource = await readCreativeSkillResource({ uri: definition.entryUri })
    return {
      definition,
      checksum: resource.checksum,
      body: withoutFrontmatter(resource.content),
    }
  }))
  const professionalSkillId = skill.skillIds[1]
  const professionalDefinition = getCreativeSkillDefinition(professionalSkillId)
  const jsonSchema = JSON.stringify(creativeOutputJsonSchema(skill.outputKind), null, 2)
  return [
    '---',
    `name: ${professionalSkillId}`,
    `description: ${JSON.stringify(professionalDefinition.summary)}`,
    '---',
    '',
    `# ${skill.title}`,
    '',
    'Use this Skill only when the current request matches this professional domain.',
    'You are the primary Wao Agent and the sole author of this professional result. Do not delegate, spawn another Agent, or look for another Wao Skill.',
    `Construct exactly one object with outputKind=${JSON.stringify(skill.outputKind)} during this Turn. The object is the single professional result: use it directly in the response, pass its exact media items to the matching Wao Operation, or save it only when the user explicitly requests persistence.`,
    'Never invent project paths or Resource identities. Use only canonical Resource ids and versions supplied by Wao tools or current context. Runtime scratch has no delivery meaning.',
    skill.executionFacts,
    ...resources.map(({ definition, checksum, body }) => [
      `<wao_skill_source id=${JSON.stringify(definition.id)} version=${JSON.stringify(definition.version)} checksum=${JSON.stringify(checksum)}>`,
      body,
      '</wao_skill_source>',
    ].join('\n')),
    'The professional object must match the authoritative schema below exactly: include every required field, include no unknown field, and never invent fields from prose examples. Media item fields are the same contract consumed by the corresponding generation Operation.',
    `<wao_output_schema outputKind=${JSON.stringify(skill.outputKind)}>`,
    jsonSchema,
    '</wao_output_schema>',
  ].filter((value): value is string => value !== null).join('\n\n')
}

export async function materializeCreativeRuntimeConfiguration(codexHomeDirectory: string): Promise<void> {
  const skillsDirectory = path.join(codexHomeDirectory, 'skills')
  await mkdir(skillsDirectory, { recursive: true, mode: 0o700 })
  await Promise.all(CREATIVE_RUNTIME_SKILLS.map(async (skill) => {
    const professionalSkillId = skill.skillIds[1]
    const skillDirectory = path.join(skillsDirectory, professionalSkillId)
    await mkdir(skillDirectory, { recursive: true, mode: 0o700 })
    await writeFile(
      path.join(skillDirectory, 'SKILL.md'),
      `${await buildRuntimeSkill(skill)}\n`,
      { mode: 0o600 },
    )
  }))
  const disabledSkills = PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS.flatMap((skillId) => [
    '[[skills.config]]',
    `path = ${tomlString(path.join(codexHomeDirectory, 'skills', '.system', skillId, 'SKILL.md'))}`,
    'enabled = false',
    '',
  ])
  await Promise.all([
    writeFile(
      path.join(codexHomeDirectory, 'AGENTS.md'),
      `${PRIMARY_AGENT_GLOBAL_INSTRUCTIONS.trim()}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(codexHomeDirectory, 'config.toml'),
      [
        '[agents]',
        'enabled = false',
        '',
        disabledSkills.join('\n'),
        '',
      ].join('\n'),
      { mode: 0o600 },
    ),
  ])
}

export function creativeSkillRoutingInstructions(): readonly string[] {
  return CREATIVE_RUNTIME_SKILLS.map((skill) => (
    `${skill.kind} -> native Skill ${skill.skillIds[1]}, outputKind=${skill.outputKind}: ${skill.description}`
  ))
}
