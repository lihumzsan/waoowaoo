import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readCreativeSkillResource } from './loader'
import { getCreativeSkillDefinition } from './registry'
import type { CreativeSkillId, CreativeWorkerKind } from './types'

export type CreativeWorkerDefinition = {
  readonly kind: CreativeWorkerKind
  readonly agentType: `wao_${CreativeWorkerKind}`
  readonly title: string
  readonly description: string
  readonly skillIds: readonly ['creative-core', Exclude<CreativeSkillId, 'creative-core'>]
  readonly deliveryContract: string
}

function defineWorker(
  definition: Omit<CreativeWorkerDefinition, 'agentType'>,
): CreativeWorkerDefinition {
  return { ...definition, agentType: `wao_${definition.kind}` }
}

export const CREATIVE_WORKER_REGISTRY: Readonly<Record<CreativeWorkerKind, CreativeWorkerDefinition>> = {
  story: defineWorker({
    kind: 'story',
    title: '故事与剧本专业子 Agent',
    description: '只负责故事、剧本创作与修改；把最终文本写入被指派的工作区路径。',
    skillIds: ['creative-core', 'story-development'],
    deliveryContract: 'Write the complete final story or screenplay deliverable to the exact assigned workspace path.',
  }),
  long_form: defineWorker({
    kind: 'long_form',
    title: '长篇制作专业子 Agent',
    description: '只负责长篇目录、连续性文档与生产索引；不代写资产、视频或音乐提示词。',
    skillIds: ['creative-core', 'long-form-production'],
    deliveryContract: 'Write the complete continuity and long-form production index to the exact assigned paths. Point to domain manifests owned by other fixed professional workers; never author their prompts.',
  }),
  direction: defineWorker({
    kind: 'direction',
    title: '创作方向专业子 Agent',
    description: '只负责创作方向；把最终 Creative Direction 写入被指派的工作区路径。',
    skillIds: ['creative-core', 'creative-direction'],
    deliveryContract: 'Write the complete final Creative Direction to the exact assigned workspace path.',
  }),
  assets: defineWorker({
    kind: 'assets',
    title: '资产设计专业子 Agent',
    description: '只负责资产筛选、设计和最终资产图片提示词；把完整生产清单写入被指派的路径。',
    skillIds: ['creative-core', 'asset-development'],
    deliveryContract: 'Write complete final asset prompts and explicit generation parameters into the assigned production manifest. Never call production tools.',
  }),
  video: defineWorker({
    kind: 'video',
    title: '视频导演专业子 Agent',
    description: '只负责视频导演、分段与最终视频提示词；把完整生产清单写入被指派的路径。',
    skillIds: ['creative-core', 'video-direction'],
    deliveryContract: 'Read the exact system/project.json assigned by the parent and use only its non-null productionCapabilities.video facts. Write complete final video prompts and explicit generation parameters into the assigned production manifest. Never guess capability limits or call production tools.',
  }),
  music: defineWorker({
    kind: 'music',
    title: '音乐导演专业子 Agent',
    description: '只负责音乐设计和最终音乐提示词；把完整生产清单写入被指派的路径。',
    skillIds: ['creative-core', 'music-direction'],
    deliveryContract: 'Read the exact system/project.json assigned by the parent and use only its non-null productionCapabilities.music facts. Write complete final music prompts and explicit generation parameters into the assigned production manifest. Never guess capability limits or call production tools.',
  }),
}

export const CREATIVE_WORKERS: readonly CreativeWorkerDefinition[] = Object.values(
  CREATIVE_WORKER_REGISTRY,
)

/** Pinned Codex system Skills are disabled for the primary Agent. A Codex upgrade that adds one fails smoke. */
export const PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS = [
  'imagegen',
  'openai-docs',
  'plugin-creator',
  'review-agent',
  'skill-creator',
  'skill-installer',
] as const

export const PRIMARY_AGENT_GLOBAL_INSTRUCTIONS = `# Wao orchestration

- The primary Wao Agent may autonomously spawn and coordinate Subagents whenever delegation materially improves exploration, planning, or execution. The user does not need to ask for Subagents explicitly.
- For professional creative work, the primary Agent must use the fixed native custom Subagent routing supplied by Wao developer instructions and must give every worker exact input paths and exclusive output paths. Spawn every fixed custom agent with \`fork_turns="none"\`; full-history forks cannot select a custom \`agent_type\`.
- Fixed Wao professional workers execute their assigned bounded deliverable directly. They must not spawn or delegate to additional agents.
- Keep delegation bounded: do not create redundant workers, and never let two agents write the same file or directory.`

function tomlString(value: string): string {
  return JSON.stringify(value)
}

async function buildDeveloperInstructions(worker: CreativeWorkerDefinition): Promise<string> {
  const skills = await Promise.all(worker.skillIds.map(async (skillId) => {
    const definition = getCreativeSkillDefinition(skillId)
    const resource = await readCreativeSkillResource({ uri: definition.entryUri })
    return `<wao_skill id=${JSON.stringify(skillId)} version=${JSON.stringify(definition.version)} checksum=${JSON.stringify(resource.checksum)}>
${resource.content.trim()}
</wao_skill>`
  }))
  return [
    `You are the fixed Wao professional worker ${worker.agentType}.`,
    'Your role and Skill set were selected deterministically by the Wao worker registry. Do not discover, load, or apply any other Wao Skill.',
    'Work only on the exact files or directories assigned by the parent Agent. Do not modify system/** or .resource pointer contents.',
    'Use assigned project-relative output paths exactly as written. Never expand them to absolute host or Runtime paths.',
    'The wao MCP server is disabled for this worker. Never submit paid production, billing, Task, approval, or Resource operations.',
    'You are the sole author of the professional deliverable for this assignment. The parent Agent may submit your file but must not copy, rewrite, or complete its professional contents.',
    worker.deliveryContract,
    ...skills,
  ].join('\n\n')
}

export async function materializeCreativeRuntimeConfiguration(codexHomeDirectory: string): Promise<void> {
  const agentsDirectory = path.join(codexHomeDirectory, 'agents')
  await mkdir(agentsDirectory, { recursive: true, mode: 0o700 })
  await Promise.all(CREATIVE_WORKERS.map(async (worker) => {
    const developerInstructions = await buildDeveloperInstructions(worker)
    const file = [
      `name = ${tomlString(worker.agentType)}`,
      `description = ${tomlString(worker.description)}`,
      `developer_instructions = ${tomlString(developerInstructions)}`,
      'sandbox_mode = "workspace-write"',
      '',
      '[mcp_servers.wao]',
      'url = "http://127.0.0.1:1/disabled-wao-mcp"',
      'enabled = false',
      '',
    ].join('\n')
    await writeFile(path.join(agentsDirectory, `${worker.agentType}.toml`), file, {
      mode: 0o600,
    })
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
        'enabled = true',
        '',
        disabledSkills.join('\n'),
        '',
      ].join('\n'),
      { mode: 0o600 },
    ),
  ])
}

export function creativeWorkerRoutingInstructions(): readonly string[] {
  return CREATIVE_WORKERS.map((worker) => (
    `${worker.kind} -> native Subagent agent_type=${worker.agentType}: ${worker.description}`
  ))
}
