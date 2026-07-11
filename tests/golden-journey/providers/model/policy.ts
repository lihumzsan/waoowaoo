import type {
  GoldenChatCompletionRequest,
  GoldenModelDecision,
} from './protocol'
import {
  buildGoldenScriptIntakePlan,
  generateGoldenResponseFormatText,
  generateGoldenStructuredValue,
} from './structured-value'

const WRITE_TOOL_PRIORITY = [
  'request_script_intake_choice',
  'ingest_script',
  'request_edit_script_review_choice',
  'approve_script',
  'generate_bible_from_script',
  'request_edit_bible_review_choice',
  'confirm_bible',
  'generate_edit_style_previews',
  'request_edit_style_choice',
  'confirm_edit_style_preview',
  'plan_chapters',
  'generate_edit_script_assets',
  'request_edit_asset_review_choice',
  'approve_edit_script_assets',
  'generate_edit_shot_execution_plan',
  'generate_edit_script_storyboard',
  'generate_edit_script_storyboard_images',
  'generate_episode_videos',
  'render_chapters',
  'generate_episode_bgm_score',
  'plan_episode_soundscape',
  'generate_episode_soundscape',
  'render_final_video',
] as const

const TOOL_ARGUMENT_OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  request_script_intake_choice: { seedText: '恐怖故事' },
  ingest_script: {
    sourceKind: 'prompt_generated_outline',
    text: 'A deterministic folk-horror story about a lost traveler, a forbidden shrine, and a closed-loop ending.',
  },
  request_edit_script_review_choice: {},
  approve_script: {},
  generate_bible_from_script: {},
  request_edit_bible_review_choice: {},
  confirm_bible: { aspectRatio: '16:9' },
  generate_edit_style_previews: {},
  request_edit_style_choice: {},
  confirm_edit_style_preview: {},
  plan_chapters: {},
  generate_edit_script_assets: {},
  request_edit_asset_review_choice: {},
  approve_edit_script_assets: {},
  generate_edit_shot_execution_plan: {},
  generate_edit_script_storyboard: {},
  generate_edit_script_storyboard_images: {},
  generate_episode_videos: {},
  render_chapters: {},
  generate_episode_bgm_score: {},
  plan_episode_soundscape: {},
  generate_episode_soundscape: {},
  render_final_video: {},
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function buildToolArguments(request: GoldenChatCompletionRequest, toolName: string): unknown {
  const tool = request.tools?.find((candidate) => candidate.function.name === toolName)
  const parameters = asRecord(tool?.function.parameters)
  const generated = asRecord(generateGoldenStructuredValue(parameters)) ?? {}
  const properties = asRecord(parameters?.properties) ?? {}
  const overrides = TOOL_ARGUMENT_OVERRIDES[toolName] ?? {}
  for (const [key, value] of Object.entries(overrides)) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) generated[key] = value
  }
  return generated
}

function availableToolNames(request: GoldenChatCompletionRequest): Set<string> {
  return new Set(request.tools?.map((tool) => tool.function.name) ?? [])
}

function toolOutputCount(request: GoldenChatCompletionRequest): number {
  return request.messages.filter((message) => message.role === 'tool').length
}

function messageText(request: GoldenChatCompletionRequest): string {
  return request.messages.flatMap((message) => {
    if (typeof message.content === 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((part) => {
      if (typeof part === 'string') return [part]
      if (!part || typeof part !== 'object' || Array.isArray(part)) return []
      const text = (part as Record<string, unknown>).text
      return typeof text === 'string' ? [text] : []
    })
  }).join('\n')
}

function generatePromptContractText(request: GoldenChatCompletionRequest): string | null {
  const prompt = messageText(request)
  if (
    prompt.includes('扩写前创作问诊')
    && prompt.includes('"questions"')
    && prompt.includes('targetRuntime')
  ) {
    return JSON.stringify(buildGoldenScriptIntakePlan())
  }
  if (
    prompt.includes('把用户的故事创意扩写成完整、连贯、可拍摄的剧本')
    && prompt.includes('"segments"')
    && prompt.includes('"episodeIndex"')
  ) {
    return JSON.stringify({
      version: 1,
      title: '禁坛归途',
      summary: '迷路旅人误入禁忌祭坛，逃离后发现自己仍在循环起点。',
      segments: [{
        episodeIndex: 0,
        episodeTitle: '禁坛归途',
        episodeSummary: '旅人触犯荒野祭坛禁忌并陷入无法逃出的循环。',
        actIndex: 0,
        actTitle: '荒野闭环',
        actSummary: '从迷路、触禁到循环真相显现。',
        sceneIndex: 0,
        title: '祭坛前的第四次',
        location: '暮色荒野与废弃祭坛',
        timeOfDay: '黄昏',
        characters: ['旅人'],
        summary: '旅人发现每次远离祭坛都会回到同一块刻着“四”的路牌前。',
        body: '暮色压住荒野。旅人拖着受伤的脚走到一座废弃祭坛前。石碑上的“死”字忽然闪烁成数字“4”。他惊恐后退，转身沿唯一的小路狂奔。风声停下时，他再次站在祭坛前，脚边仍是自己刚才留下的血迹。旅人抬头，石碑上的“4”熄灭，又缓慢亮起。远处传来与他一模一样的喘息声。',
        beats: [{
          beatIndex: 0,
          title: '循环显形',
          summary: '旅人逃离失败，并意识到自己已被祭坛困在同一时刻。',
        }],
      }],
    })
  }
  return null
}

function selectWriteTool(request: GoldenChatCompletionRequest, forcedToolName?: string | null): string | null {
  const available = availableToolNames(request)
  const alreadyCalled = new Set<string>()
  for (const message of request.messages) {
    if (!Array.isArray(message.tool_calls)) continue
    for (const toolCall of message.tool_calls) {
      const record = asRecord(toolCall)
      const fn = asRecord(record?.function)
      if (typeof fn?.name === 'string') alreadyCalled.add(fn.name)
    }
  }
  if (forcedToolName && available.has(forcedToolName) && !alreadyCalled.has(forcedToolName)) {
    return forcedToolName
  }
  return WRITE_TOOL_PRIORITY.find((toolName) => (
    available.has(toolName) && !alreadyCalled.has(toolName)
  )) ?? null
}

export function decideGoldenModelResponse(input: {
  readonly scenarioId: string
  readonly request: GoldenChatCompletionRequest
  readonly requestOrdinal: number
  readonly forcedToolName?: string | null
}): GoldenModelDecision {
  if (input.scenarioId === 'disconnect-mid-tool-call') return { kind: 'disconnect' }

  const structuredText = generateGoldenResponseFormatText(input.request.responseFormat)
    ?? generatePromptContractText(input.request)
  if (structuredText) {
    return {
      kind: 'text',
      text: structuredText,
    }
  }

  const toolName = selectWriteTool(input.request, input.forcedToolName)
  if (
    input.scenarioId === 'stop-after-successful-confirmation'
    && toolOutputCount(input.request) > 0
  ) {
    return {
      kind: 'text',
      text: 'Confirmation succeeded. I am stopping without requesting the next operation.',
    }
  }
  if (!toolName) {
    return {
      kind: 'text',
      text: 'The deterministic test model reached a stable boundary.',
    }
  }
  const argumentsValue = buildToolArguments(input.request, toolName)
  if (input.scenarioId === 'duplicate-tool-call') {
    const argumentsJson = JSON.stringify(argumentsValue)
    return {
      kind: 'tool_calls',
      calls: [1, 2].map((ordinal) => ({
        toolCallId: `golden_call_${input.requestOrdinal}_${toolName}_duplicate_${String(ordinal)}`,
        toolName,
        argumentsJson,
      })),
    }
  }
  return {
    kind: 'tool_call',
    toolCallId: `golden_call_${input.requestOrdinal}_${toolName}`,
    toolName,
    argumentsJson: JSON.stringify(argumentsValue),
  }
}
