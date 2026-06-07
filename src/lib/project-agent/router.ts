import { generateObject, type LanguageModel, type UIMessage } from 'ai'
import { z } from 'zod'
import type { ProjectPhaseSnapshot } from './project-phase'
import type { ProjectAgentContext } from './types'
import { normalizeProjectAgentLocale, type ProjectAgentLocale } from './locale'

type UnknownObject = { [key: string]: unknown }

export type ProjectAgentIntent = 'query' | 'plan' | 'act'

export type ProjectAgentDomain =
  | 'project'
  | 'skill'
  | 'edit-script'
  | 'run'
  | 'task'
  | 'storyboard'
  | 'asset'
  | 'asset-hub'
  | 'config'
  | 'billing'
  | 'governance'
  | 'download'
  | 'debug'
  | 'unknown'

export interface ProjectAgentRouteDecision {
  intent: ProjectAgentIntent
  domains: ProjectAgentDomain[]
  requestedGroups: string[][]
  needsClarification: boolean
  clarifyingQuestion: string | null
  reasoning: string[]
  latestUserText: string
}

const routerSchema = z.object({
  intent: z.enum(['query', 'plan', 'act']),
  domains: z.array(z.enum([
    'project',
    'skill',
    'edit-script',
    'run',
    'task',
    'storyboard',
    'asset',
    'asset-hub',
    'config',
    'billing',
    'governance',
    'download',
    'debug',
    'unknown',
  ])).min(1),
  requestedGroups: z.array(z.array(z.string().min(1)).min(1)).max(8),
  needsClarification: z.boolean(),
  clarifyingQuestion: z.string().nullable(),
  reasoning: z.array(z.string()).max(8),
})

function serializeGroupPath(groupPath: string[]): string {
  return groupPath.join('/')
}

function normalizeGroupPath(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const trimmed = raw
    .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
    .filter(Boolean)
  return trimmed.length > 0 ? trimmed : null
}

function filterRequestedGroups(params: {
  requestedGroups: unknown
  allowedRequestedGroups: string[][]
  reasoning: string[]
}): string[][] {
  const allowedSet = new Set<string>(
    params.allowedRequestedGroups.map((groupPath) => serializeGroupPath(groupPath)),
  )
  const requested = Array.isArray(params.requestedGroups) ? params.requestedGroups : []

  const output: string[][] = []
  const seen = new Set<string>()
  let dropped = 0

  for (const item of requested) {
    const normalized = normalizeGroupPath(item)
    if (!normalized) {
      dropped += 1
      continue
    }
    const key = serializeGroupPath(normalized)
    if (!allowedSet.has(key)) {
      dropped += 1
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }

  if (dropped > 0) {
    params.reasoning.push(`router:requestedGroups_dropped=${String(dropped)}`)
  }

  return output
}

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function extractLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const chunks: string[] = []
    for (const part of message.parts) {
      if (!isRecord(part)) continue
      if (part.type !== 'text') continue
      if (typeof part.text !== 'string') continue
      const trimmed = part.text.trim()
      if (trimmed) chunks.push(trimmed)
    }
    const joined = chunks.join('\n').trim()
    if (joined) return joined
  }
  return ''
}

function extractConversationExcerpt(messages: UIMessage[]): string {
  return messages
    .slice(-8)
    .map((message) => {
      const parts = message.parts
        .map((part) => {
          if (!isRecord(part)) return ''
          if (part.type === 'text' && typeof part.text === 'string') return part.text.trim()
          return ''
        })
        .filter(Boolean)
      if (parts.length === 0) return null
      return `${message.role.toUpperCase()}: ${parts.join(' ')}`
    })
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

function buildPhaseSummary(phase: ProjectPhaseSnapshot): string {
  return [
    `phase=${phase.phase}`,
    `activePlanRuns=${String(phase.activePlanRunCount)}`,
    `failedItems=${phase.failedItems.join(';') || '-'}`,
    `staleArtifacts=${phase.staleArtifacts.join(';') || '-'}`,
    `actions.plan=${phase.availableActions.planMode.join(',') || '-'}`,
    `actions.act=${phase.availableActions.actMode.join(',') || '-'}`,
  ].join('\n')
}

function buildRouterPrompt(params: {
  locale: ProjectAgentLocale
  latestUserText: string
  conversationExcerpt: string
  phaseSummary: string
  context: ProjectAgentContext
  allowedRequestedGroups: string[][]
}): { system: string; prompt: string } {
  const episodeId = params.context.episodeId || 'none'
  const interactionMode = params.context.interactionMode || 'auto'

  const groupList = JSON.stringify(params.allowedRequestedGroups)

  if (params.locale === 'en') {
    return {
      system: [
        'You are a strict project assistant router.',
        'Your task is to classify the user turn before the main assistant acts.',
        'If the request is ambiguous, set needsClarification=true and provide one short clarifyingQuestion.',
        'If any tool group might be needed, include it. Prefer recall over aggressive exclusion.',
        'For creative, production, writing, storyboard, or media goals, request the direct operation groups that may be needed; do not route through Skill unless the user explicitly asks for skills or reusable planning documents.',
        'For edit-first production requests such as AI edit, short-film generation, screenplay-to-edit-table, assets, storyboard, video blocks, or final render, prefer these direct groups as needed: ["edit-script"], ["media","video"], ["media","music"], ["project","data"], ["storyboard","edit"].',
        'Do not request fixed-chain groups; legacy fixed-chain routing is forbidden.',
        'Do not rely on previous rule routing. Output only from the provided schema.',
        'requestedGroups is a list of groupPath arrays, e.g. ["skill"].',
        `Allowed requestedGroups (choose from this list): ${groupList}`,
      ].join('\n'),
      prompt: [
        `episodeId=${episodeId}`,
        `interactionMode=${interactionMode}`,
        '',
        'Project state summary:',
        params.phaseSummary,
        '',
        'Recent conversation excerpt:',
        params.conversationExcerpt || 'NONE',
        '',
        'Latest user request:',
        params.latestUserText || 'NONE',
      ].join('\n'),
    }
  }

  return {
    system: [
      '你是一个严格的项目 assistant 路由器。',
      '你的任务是在主 assistant 执行前，对当前用户请求做结构化分类。',
      '如果请求有歧义，必须设置 needsClarification=true，并提供一个简短的 clarifyingQuestion。',
      '如果某个工具 group 可能需要用到，就把它包含进去。宁可高召回，不要激进排除。',
      '对于创作、制作、写作、分镜或媒体生成目标，请请求可能需要的直接 operation group；除非用户明确要求技能或可复用规划文档，否则不要通过 Skill 转发。',
      '对于剪辑先行制作请求，例如 AI 剪辑、生成短片、剧本到剪辑表、资产、分镜、视频片段或最终成片，按需要优先请求这些直接 group：["edit-script"]、["media","video"]、["media","music"]、["project","data"]、["storyboard","edit"]。',
      '不要请求固定链路 group；旧固定链路路由已禁止。',
      '禁止依赖旧的规则路由，必须只按 schema 输出。',
      'requestedGroups 是 groupPath 数组列表，例如 ["skill"]。',
      `允许的 requestedGroups（必须从该列表中选择）：${groupList}`,
    ].join('\n'),
    prompt: [
      `episodeId=${episodeId}`,
      `interactionMode=${interactionMode}`,
      '',
      '项目状态摘要：',
      params.phaseSummary,
      '',
      '最近对话摘录：',
      params.conversationExcerpt || 'NONE',
      '',
      '最新用户请求：',
      params.latestUserText || 'NONE',
    ].join('\n'),
  }
}

export async function routeProjectAgentRequest(input: {
  messages: UIMessage[]
  phase: ProjectPhaseSnapshot
  context: ProjectAgentContext
  model: LanguageModel
  allowedRequestedGroups: string[][]
}): Promise<ProjectAgentRouteDecision> {
  const latestUserText = extractLatestUserText(input.messages)
  if (!latestUserText) {
    return {
      intent: 'query',
      domains: ['unknown'],
      requestedGroups: [],
      needsClarification: true,
      clarifyingQuestion: normalizeProjectAgentLocale(input.context.locale) === 'en'
        ? 'What do you want me to help with in this project?'
        : '你希望我在这个项目里帮你处理什么？',
      reasoning: ['router:empty-user-text'],
      latestUserText,
    }
  }

  const locale = normalizeProjectAgentLocale(input.context.locale)
  const prompt = buildRouterPrompt({
    locale,
    latestUserText,
    conversationExcerpt: extractConversationExcerpt(input.messages),
    phaseSummary: buildPhaseSummary(input.phase),
    context: input.context,
    allowedRequestedGroups: input.allowedRequestedGroups,
  })

  const result = await generateObject({
    model: input.model,
    schema: routerSchema,
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0,
  })

  const object = result.object
  const clarificationRequired = object.needsClarification
  const clarifyingQuestion = clarificationRequired
    ? (object.clarifyingQuestion?.trim()
      || (locale === 'en'
        ? 'Please clarify the exact action or outcome you want.'
        : '请补充你希望我执行的具体动作或目标结果。'))
    : null

  const reasoning = [...object.reasoning]
  const requestedGroups = filterRequestedGroups({
    requestedGroups: object.requestedGroups,
    allowedRequestedGroups: input.allowedRequestedGroups,
    reasoning,
  })

  return {
    intent: object.intent,
    domains: Array.from(new Set(object.domains)),
    requestedGroups,
    needsClarification: clarificationRequired,
    clarifyingQuestion,
    reasoning,
    latestUserText,
  }
}
