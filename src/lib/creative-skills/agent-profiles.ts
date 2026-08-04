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

export type CreativeWorkerDefinition = {
  readonly kind: CreativeWorkerKind
  readonly agentType: `wao_${CreativeWorkerKind}`
  readonly title: string
  readonly description: string
  readonly skillIds: readonly ['creative-core', Exclude<CreativeSkillId, 'creative-core'>]
  readonly outputKind: CreativeOutputKind
  readonly executionFacts: string | null
}

function defineWorker(
  definition: Omit<CreativeWorkerDefinition, 'agentType' | 'outputKind'>,
): CreativeWorkerDefinition {
  return {
    ...definition,
    agentType: `wao_${definition.kind}`,
    outputKind: CREATIVE_WORKER_OUTPUT_KIND[definition.kind],
  }
}

export const CREATIVE_WORKER_REGISTRY: Readonly<Record<CreativeWorkerKind, CreativeWorkerDefinition>> = {
  story: defineWorker({
    kind: 'story',
    title: '故事与剧本专业子 Agent',
    description: '只负责故事、剧本创作与修改；交付固定 screenplay JSON。',
    skillIds: ['creative-core', 'story-development'],
    executionFacts: null,
  }),
  long_form: defineWorker({
    kind: 'long_form',
    title: '长篇制作专业子 Agent',
    description: '只负责长篇目录、连续性事实与生产索引；交付固定 long_form_plan JSON。',
    skillIds: ['creative-core', 'long-form-production'],
    executionFacts: 'Point to JSON deliverables owned by other fixed professional workers; never author their prompts.',
  }),
  direction: defineWorker({
    kind: 'direction',
    title: '创作方向专业子 Agent',
    description: '只负责创作方向；交付固定 creative_direction JSON。',
    skillIds: ['creative-core', 'creative-direction'],
    executionFacts: null,
  }),
  assets: defineWorker({
    kind: 'assets',
    title: '资产设计专业子 Agent',
    description: '只负责资产筛选、设计和最终资产图片提示词；交付固定 asset_manifest JSON。',
    skillIds: ['creative-core', 'asset-development'],
    executionFacts: 'Every produced asset must include its stable creative identity, complete final prompt, explicit generation parameters, and project-relative .resource placement in the one assigned JSON file.',
  }),
  video: defineWorker({
    kind: 'video',
    title: '视频导演专业子 Agent',
    description: '只负责视频导演、分段与最终视频提示词；交付固定 video_prompt_set JSON。',
    skillIds: ['creative-core', 'video-direction'],
    executionFacts: 'Read the exact system/project.json assigned by the parent and use only its non-null productionCapabilities.video facts. Never guess capability limits.',
  }),
  music: defineWorker({
    kind: 'music',
    title: '音乐导演专业子 Agent',
    description: '只负责音乐设计和最终音乐提示词；交付固定 music_direction JSON。',
    skillIds: ['creative-core', 'music-direction'],
    executionFacts: 'Read the exact system/project.json assigned by the parent and use only its non-null productionCapabilities.music facts. Never guess capability limits.',
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
- For professional creative work, the primary Agent must use the fixed native custom Subagent routing supplied by Wao developer instructions. Assign exactly one exclusive project-relative .json output path for the worker's registered outputKind. Spawn every fixed custom agent with \`fork_turns="none"\`; full-history forks cannot select a custom \`agent_type\`.
- Fixed Wao professional workers execute their assigned bounded deliverable directly. They must not spawn or delegate to additional agents.
- The primary Agent never writes, copies, repairs, or rewrites professional creative contents. It may read the completed JSON and, for asset_manifest, video_prompt_set, or music_direction with actual items, submit that exact file through Wao MCP.
- If Workspace checkpoint or production validation rejects a professional JSON, send the exact reported field correction back to the same fixed worker. Do not change paths, rewrite the manifest, or repeat the same submission until that worker has produced a new file version.
- Keep delegation bounded: do not create redundant workers, and never let two agents write the same file or directory.`

function tomlString(value: string): string {
  return JSON.stringify(value)
}

async function buildDeveloperInstructions(worker: CreativeWorkerDefinition): Promise<string> {
  const outputDefinition = readCreativeOutputDefinition(worker.outputKind)
  if (
    outputDefinition.workerKind !== worker.kind
    || outputDefinition.professionalSkillId !== worker.skillIds[1]
  ) {
    throw new Error(`CREATIVE_WORKER_OUTPUT_REGISTRY_MISMATCH:${worker.kind}`)
  }
  const skills = await Promise.all(worker.skillIds.map(async (skillId) => {
    const definition = getCreativeSkillDefinition(skillId)
    const resource = await readCreativeSkillResource({ uri: definition.entryUri })
    return `<wao_skill id=${JSON.stringify(skillId)} version=${JSON.stringify(definition.version)} checksum=${JSON.stringify(resource.checksum)}>
${resource.content.trim()}
</wao_skill>`
  }))
  const jsonSchema = JSON.stringify(creativeOutputJsonSchema(worker.outputKind), null, 2)
  return [
    `You are the fixed Wao professional worker ${worker.agentType}.`,
    'Your role and Skill set were selected deterministically by the Wao worker registry. Do not discover, load, or apply any other Wao Skill.',
    'Work only on the exact files or directories assigned by the parent Agent. Do not modify system/** or .resource pointer contents.',
    `Your only formal deliverable is exactly one strict JSON object with outputKind=${JSON.stringify(worker.outputKind)}, written to the one assigned project-relative .json path. Do not create an auxiliary Markdown deliverable, a second manifest, or a parallel explanation file.`,
    'Use the assigned project-relative output path exactly as written. Never expand any path to an absolute host or Runtime path. Every media outputPath inside a production JSON must be project-relative, must end in .resource, and must not start with /, ./, ../, system/, or .wao/.',
    'The wao MCP server is disabled for this worker. Never submit paid production, billing, Task, approval, or Resource operations.',
    'You are the sole author of the professional deliverable for this assignment. The parent Agent may submit your file but must not copy, rewrite, or complete its professional contents.',
    worker.executionFacts,
    ...skills,
    'The JSON must match the authoritative schema below exactly: include every required field, include no unknown field, emit raw JSON without Markdown fences, and never invent a schema from a Skill example. This schema is the same machine contract enforced at Workspace checkpoint and production submission.',
    `<wao_output_schema outputKind=${JSON.stringify(worker.outputKind)}>
${jsonSchema}
</wao_output_schema>`,
  ].filter((value): value is string => value !== null).join('\n\n')
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
    `${worker.kind} -> native Subagent agent_type=${worker.agentType}, outputKind=${worker.outputKind}: ${worker.description}`
  ))
}
