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
    description: '只负责资产筛选、设计和最终资产图片提示词；最终回复固定 asset_generation_batch JSON。',
    skillIds: ['creative-core', 'asset-development'],
    executionFacts: 'Every produced asset must include its stable creative identity, complete final prompt, explicit generation parameters, and user-visible name. The server owns Resource placement.',
  }),
  video: defineWorker({
    kind: 'video',
    title: '视频导演专业子 Agent',
    description: '只负责视频导演、分段与最终视频提示词；最终回复固定 video_generation_batch JSON。',
    skillIds: ['creative-core', 'video-direction'],
    executionFacts: 'Use only the non-null productionCapabilities.video facts injected below by the Wao system. Never ask the parent to relay or guess capability limits.',
  }),
  music: defineWorker({
    kind: 'music',
    title: '音乐导演专业子 Agent',
    description: '只负责音乐设计和最终音乐提示词；最终回复固定 audio_generation_batch JSON。',
    skillIds: ['creative-core', 'music-direction'],
    executionFacts: 'Use only the non-null productionCapabilities.music facts injected below by the Wao system. Never ask the parent to relay or guess capability limits.',
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
- For professional creative work, the primary Agent must use the fixed native custom Subagent routing supplied by Wao developer instructions. Spawn every fixed custom agent with \`fork_turns="none"\`; full-history forks cannot select a custom \`agent_type\`.
- Fixed Wao professional workers execute their assigned bounded deliverable directly. They must not spawn or delegate to additional agents.
- A professional worker returns one strict JSON object in its final response. This response is an in-memory handoff to the primary Agent; it is not a project file and must not be saved to Canvas automatically.
- The primary Agent never repairs or rewrites professional creative contents. For an asset_generation_batch, video_generation_batch, or audio_generation_batch with actual items, pass those exact items to create_image, create_video, or create_audio respectively.
- If the strict output or media tool validation rejects a field, send the exact correction back to the same fixed worker. Do not rewrite the output or repeat the same submission until the worker returns a corrected final object.
- Keep delegation bounded: do not create redundant workers.`

export const PROJECT_PRODUCTION_CONTEXT_HOOK_CONTRACT = {
  revision: 2,
  environmentUrlKey: 'WAO_MCP_PROJECT_CONTEXT_URL',
  bearerTokenKey: 'WAO_MCP_RUNTIME_BEARER_TOKEN',
  subagentEvent: 'SubagentStart',
  subagentMatcher: '^wao_(story|long_form|direction|assets|video|music)$',
} as const

const PROJECT_PRODUCTION_CONTEXT_HOOK_SCRIPT = `const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const event = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const eventName = event?.hook_event_name
if (eventName !== 'SubagentStart') {
  throw new Error('WAO_PROJECT_CONTEXT_HOOK_EVENT_INVALID')
}
const url = process.env.WAO_MCP_PROJECT_CONTEXT_URL
const token = process.env.WAO_MCP_RUNTIME_BEARER_TOKEN
if (!url || !token) throw new Error('WAO_PROJECT_CONTEXT_HOOK_ENVIRONMENT_MISSING')
const response = await fetch(url, {
  headers: { authorization: \`Bearer \${token}\`, accept: 'application/json' },
})
if (!response.ok) throw new Error(\`WAO_PROJECT_CONTEXT_HOOK_FETCH_FAILED:\${response.status}\`)
const context = await response.json()
const additionalContext = [
  'The Wao system injected the current project production context below as read-only developer context.',
  'It is authoritative for this request. Never ask the parent Agent or user to relay, repeat, or guess these facts.',
  '<wao_project_production_context>',
  JSON.stringify(context, null, 2),
  '</wao_project_production_context>',
].join('\\n')
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: eventName, additionalContext },
}))
`

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
    'Treat the writable workspace as disposable scratch only. Scratch files are never project resources.',
    `Your only formal deliverable is exactly one strict JSON object with outputKind=${JSON.stringify(worker.outputKind)} in your final response. Do not create a manifest file, an auxiliary Markdown deliverable, or a parallel explanation file.`,
    'Never invent project paths. Use canonical Resource IDs and versions supplied by the parent for references. The server owns media placement.',
    'The wao MCP server is disabled for this worker. Never submit paid production, billing, Task, approval, or Resource operations.',
    'You are the sole author of the professional result for this assignment. The parent Agent may submit its media items but must not rewrite or complete its professional contents.',
    worker.executionFacts,
    ...skills,
    'The final JSON must match the authoritative schema below exactly: include every required field, include no unknown field, emit raw JSON without Markdown fences, and never invent a schema from a Skill example. Media item fields are the same contract consumed by the corresponding generation tool.',
    `<wao_output_schema outputKind=${JSON.stringify(worker.outputKind)}>
${jsonSchema}
</wao_output_schema>`,
  ].filter((value): value is string => value !== null).join('\n\n')
}

export async function materializeCreativeRuntimeConfiguration(codexHomeDirectory: string): Promise<void> {
  const agentsDirectory = path.join(codexHomeDirectory, 'agents')
  const hooksDirectory = path.join(codexHomeDirectory, 'hooks')
  await Promise.all([
    mkdir(agentsDirectory, { recursive: true, mode: 0o700 }),
    mkdir(hooksDirectory, { recursive: true, mode: 0o700 }),
  ])
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
        '[features]',
        'hooks = true',
        '',
        '[agents]',
        'enabled = true',
        '',
        disabledSkills.join('\n'),
        '',
      ].join('\n'),
      { mode: 0o600 },
    ),
    writeFile(
      path.join(hooksDirectory, 'project-production-context.mjs'),
      PROJECT_PRODUCTION_CONTEXT_HOOK_SCRIPT,
      { mode: 0o600 },
    ),
    writeFile(
      path.join(codexHomeDirectory, 'hooks.json'),
      `${JSON.stringify({
        description: 'Wao system-owned project production context injection.',
        hooks: {
          SubagentStart: [{
            matcher: PROJECT_PRODUCTION_CONTEXT_HOOK_CONTRACT.subagentMatcher,
            hooks: [{
              type: 'command',
              command: 'node "$CODEX_HOME/hooks/project-production-context.mjs"',
              timeout: 10,
              additionalContextLimit: 5_000,
            }],
          }],
        },
      }, null, 2)}\n`,
      { mode: 0o600 },
    ),
  ])
}

export function creativeWorkerRoutingInstructions(): readonly string[] {
  return CREATIVE_WORKERS.map((worker) => (
    `${worker.kind} -> native Subagent agent_type=${worker.agentType}, outputKind=${worker.outputKind}: ${worker.description}`
  ))
}
