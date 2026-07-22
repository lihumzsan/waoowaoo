import type {
  GoldenChatCompletionRequest,
  GoldenModelDecision,
} from './protocol'
import {
  generateGoldenResponseFormatText,
  generateGoldenStructuredValue,
} from './structured-value'

export const GOLDEN_FREEFORM_TEXT_REQUEST = '自由生成三个文字候选'
export const GOLDEN_FREEFORM_IMAGE_REQUEST = '自由生成三张图片候选'
export const GOLDEN_PARALLEL_IMAGE_REQUEST = '并行生成三个独立图片资产'
export const GOLDEN_FREEFORM_RETRY_REQUEST = '只重试失败的图片候选'
export const GOLDEN_FREEFORM_VIDEO_REQUEST = '复用成功图片生成两个视频候选'
export const GOLDEN_FREEFORM_AUDIO_REQUEST = '根据成功视频生成一段配乐'
export const GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST = '从空项目直接生成一个视频'
export const GOLDEN_FREEFORM_ADOPT_REQUEST = '选择第二张图片作为主视觉'
export const GOLDEN_FREEFORM_SCREENPLAY_REQUEST = '创作一部约240秒、全程保持单一连续场景的完整剧本'
export const GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST = '为当前项目设计一份文字 Style Bible，不要生成预览图'
export const GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST = '用一张选择卡询问我是否采用刚才的 Style Bible，只处理这个当前决定'
export const GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST = '现在为了并行制作和失败恢复，把当前剧本规划为两个可独立执行的 Chapter'
export const GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST = '采用刚才的 Chapter 规划作为当前制作单元'
export const GOLDEN_STOP_REPLY_REQUEST = '停止当前 AI 回复验证'
export const GOLDEN_STOP_RECOVERY_REQUEST = '取消后新对话恢复验证'

const FREEFORM_REQUEST_MARKERS = [
  GOLDEN_FREEFORM_TEXT_REQUEST,
  GOLDEN_FREEFORM_IMAGE_REQUEST,
  GOLDEN_PARALLEL_IMAGE_REQUEST,
  GOLDEN_FREEFORM_RETRY_REQUEST,
  GOLDEN_FREEFORM_VIDEO_REQUEST,
  GOLDEN_FREEFORM_AUDIO_REQUEST,
  GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST,
  GOLDEN_FREEFORM_ADOPT_REQUEST,
  GOLDEN_FREEFORM_SCREENPLAY_REQUEST,
  GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST,
  GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST,
  GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST,
  GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST,
  GOLDEN_STOP_REPLY_REQUEST,
  GOLDEN_STOP_RECOVERY_REQUEST,
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function messageContentText(message: GoldenChatCompletionRequest['messages'][number]): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      const record = asRecord(part)
      if (typeof record?.text === 'string') return record.text
      return JSON.stringify(part) ?? ''
    }).join('\n')
  }
  const record = asRecord(content)
  if (typeof record?.text === 'string') return record.text
  return content == null ? '' : JSON.stringify(content) ?? ''
}

function messageText(request: GoldenChatCompletionRequest): string {
  return request.messages.map(messageContentText).join('\n')
}

function currentProjectVideoRatio(request: GoldenChatCompletionRequest): string | null | undefined {
  const matches = [...messageText(request).matchAll(/^config\.videoRatio=([^\n]+)$/gm)]
  const value = matches.at(-1)?.[1]?.trim()
  if (!value) return undefined
  return value === 'none' ? null : value
}

function instructionRequiresVideoRatio(instruction: string): boolean {
  return [
    GOLDEN_FREEFORM_IMAGE_REQUEST,
    GOLDEN_PARALLEL_IMAGE_REQUEST,
    GOLDEN_FREEFORM_RETRY_REQUEST,
    GOLDEN_FREEFORM_VIDEO_REQUEST,
    GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST,
  ].some((marker) => instruction.includes(marker))
}

function latestFreeformInstruction(
  request: GoldenChatCompletionRequest,
): { readonly index: number; readonly text: string } | null {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index]
    if (message?.role !== 'user') continue
    const text = messageContentText(message)
    if (FREEFORM_REQUEST_MARKERS.some((marker) => text.includes(marker))) return { index, text }
  }
  return null
}

function calledToolsAfter(request: GoldenChatCompletionRequest, messageIndex: number): ReadonlySet<string> {
  const called = new Set<string>()
  request.messages.slice(messageIndex + 1).forEach((message) => {
    if (!Array.isArray(message.tool_calls)) return
    message.tool_calls.forEach((toolCall) => {
      const fn = asRecord(asRecord(toolCall)?.function)
      if (typeof fn?.name === 'string') called.add(fn.name)
    })
  })
  return called
}

function allCalledTools(request: GoldenChatCompletionRequest): ReadonlySet<string> {
  return calledToolsAfter(request, -1)
}

function parseMessageJson(message: GoldenChatCompletionRequest['messages'][number]): unknown {
  if (typeof message.content !== 'string') return message.content
  try {
    return JSON.parse(message.content) as unknown
  } catch {
    return null
  }
}

function containsSubmittedTaskReceipt(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSubmittedTaskReceipt)
  const record = asRecord(value)
  if (!record) return false
  const hasTaskIdentity = (
    typeof record.taskId === 'string'
    || (Array.isArray(record.taskIds) && record.taskIds.some((taskId) => typeof taskId === 'string'))
  )
  if (record.async === true && hasTaskIdentity) return true
  return Object.values(record).some(containsSubmittedTaskReceipt)
}

function latestToolResultSubmittedTasks(request: GoldenChatCompletionRequest): boolean {
  const latest = request.messages.at(-1)
  return latest?.role === 'tool' && containsSubmittedTaskReceipt(parseMessageJson(latest))
}

function collectResourceRecords(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectResourceRecords(item, output))
    return
  }
  const record = asRecord(value)
  if (!record) return
  const resource = asRecord(record.resource)
  if (resource && typeof resource.resourceId === 'string') output.push(resource)
  Object.values(record).forEach((item) => collectResourceRecords(item, output))
}

function listedResourceRecords(request: GoldenChatCompletionRequest): readonly Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  request.messages
    .filter((message) => message.role === 'tool')
    .forEach((message) => collectResourceRecords(parseMessageJson(message), records))
  return [...new Map(records.map((record) => [String(record.resourceId), record])).values()]
}

function resourceReferences(
  request: GoldenChatCompletionRequest,
  mediaType: 'image' | 'video',
): readonly Record<string, unknown>[] {
  return listedResourceRecords(request).flatMap((resource) => {
    if (resource.mediaType !== mediaType || resource.status !== 'ready') return []
    const revision = asRecord(resource.headRevision)
    if (
      typeof resource.resourceId !== 'string'
      || typeof revision?.revisionId !== 'string'
      || typeof revision.fingerprint !== 'string'
    ) return []
    return [{
      resourceId: resource.resourceId,
      revisionId: revision.revisionId,
      fingerprint: revision.fingerprint,
      role: 'reference',
    }]
  })
}

function resourceBySchema(
  request: GoldenChatCompletionRequest,
  schemaId: string,
): Record<string, unknown> | null {
  return listedResourceRecords(request).find((resource) => (
    resource.schemaId === schemaId && resource.status === 'ready'
  )) ?? null
}

function exactResourceRevision(resource: Record<string, unknown> | null): {
  resourceId: string
  revisionId: string
  fingerprint: string
} {
  const revision = asRecord(resource?.headRevision)
  if (
    typeof resource?.resourceId !== 'string'
    || typeof revision?.revisionId !== 'string'
    || typeof revision.fingerprint !== 'string'
  ) {
    throw new Error('GOLDEN_EXACT_RESOURCE_REVISION_MISSING')
  }
  return {
    resourceId: resource.resourceId,
    revisionId: revision.revisionId,
    fingerprint: revision.fingerprint,
  }
}

function resourceText(resource: Record<string, unknown> | null): string {
  const revision = asRecord(resource?.headRevision)
  const content = asRecord(revision?.content)
  if (content?.kind !== 'text' || typeof content.text !== 'string') {
    throw new Error('GOLDEN_TEXT_RESOURCE_CONTENT_MISSING')
  }
  return content.text
}

function failedResourceIds(request: GoldenChatCompletionRequest): readonly string[] {
  return listedResourceRecords(request).flatMap((resource) => (
    resource.status === 'failed' && typeof resource.resourceId === 'string' ? [resource.resourceId] : []
  ))
}

function availableToolNames(request: GoldenChatCompletionRequest): Set<string> {
  return new Set(request.tools?.map((tool) => tool.function.name) ?? [])
}

function selectFreeformTool(request: GoldenChatCompletionRequest): string | null | undefined {
  const instruction = latestFreeformInstruction(request)
  if (!instruction) return undefined
  if (request.messages.slice(instruction.index + 1).some((message) => messageContentText(message).includes('[task_update]'))) {
    return null
  }
  const available = availableToolNames(request)
  const called = calledToolsAfter(request, instruction.index)
  const choose = (toolName: string): string | null => available.has(toolName) && !called.has(toolName) ? toolName : null
  if (instructionRequiresVideoRatio(instruction.text) && currentProjectVideoRatio(request) === null) {
    return choose('request_choice')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_TEXT_REQUEST)) return choose('create_text')
  if (instruction.text.includes(GOLDEN_FREEFORM_IMAGE_REQUEST)) return choose('create_image')
  if (instruction.text.includes(GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST)) return choose('create_video')
  if (instruction.text.includes(GOLDEN_FREEFORM_RETRY_REQUEST)) {
    return called.has('list_resources') ? choose('create_image') : choose('list_resources')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_VIDEO_REQUEST)) {
    return called.has('list_resources') ? choose('create_video') : choose('list_resources')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_AUDIO_REQUEST)) {
    return called.has('list_resources') ? choose('create_audio') : choose('list_resources')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_ADOPT_REQUEST)) {
    return called.has('list_resources') ? choose('adopt_resource') : choose('list_resources')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_SCREENPLAY_REQUEST)) {
    return choose('delegate_creative_work')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST)) {
    return choose('delegate_creative_work')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST)) {
    return called.has('list_resources') ? choose('request_choice') : choose('list_resources')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST)) {
    return called.has('list_resources') ? choose('delegate_creative_work') : choose('list_resources')
  }
  if (instruction.text.includes(GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST)) {
    return called.has('list_resources') ? choose('adopt_chapters') : choose('list_resources')
  }
  return null
}

function buildToolArguments(request: GoldenChatCompletionRequest, toolName: string): unknown {
  const instruction = latestFreeformInstruction(request)?.text ?? ''
  if (
    toolName === 'request_choice'
    && instructionRequiresVideoRatio(instruction)
    && currentProjectVideoRatio(request) === null
  ) {
    const ratios = [
      { value: '16:9', label: '16:9 横屏', description: '适合常规视频与宽幅叙事。' },
      { value: '9:16', label: '9:16 竖屏', description: '适合手机短视频。' },
      { value: '21:9', label: '21:9 宽银幕', description: '适合强调电影宽银幕构图。' },
    ] as const
    return {
      subject: { kind: 'none' },
      card: {
        mode: 'select',
        replyMode: 'none',
        title: '请选择当前项目的画面比例',
        description: '这个选择只会保存当前项目的画面比例。',
        groups: [{
          key: 'videoRatio',
          label: '画面比例',
          required: true,
          presentation: 'aspect_ratio',
          options: ratios,
        }],
        submitLabel: '保存本次画面比例',
      },
      commitments: ratios.map((ratio) => ({
        when: { kind: 'option', groupKey: 'videoRatio', optionValue: ratio.value },
        operationId: 'update_project_config',
        inputJson: JSON.stringify({ videoRatio: ratio.value }),
      })),
    }
  }
  if (toolName === 'create_text' && instruction.includes(GOLDEN_FREEFORM_TEXT_REQUEST)) {
    return {
      prompt: 'Create three distinct short story concepts.',
      content: {
        kind: 'candidates',
        candidates: [
          { name: 'Concept 1', text: 'A lighthouse remembers every ship it failed to save.' },
          { name: 'Concept 2', text: 'A paper city wakes whenever its maker falls asleep.' },
          { name: 'Concept 3', text: 'A train crosses one impossible station each midnight.' },
        ],
      },
    }
  }
  if (toolName === 'create_image' && instruction.includes(GOLDEN_FREEFORM_RETRY_REQUEST)) {
    return { request: { kind: 'retry', resourceIds: failedResourceIds(request) } }
  }
  if (toolName === 'create_image' && instruction.includes(GOLDEN_FREEFORM_IMAGE_REQUEST)) {
    return {
      request: {
        kind: 'new',
        count: 3,
        prompt: 'A cinematic midnight shrine in mist, wide composition.',
      },
    }
  }
  if (toolName === 'list_resources') {
    if (instruction.includes(GOLDEN_FREEFORM_RETRY_REQUEST)) return { mediaType: 'image', status: 'failed', limit: 6 }
    if (instruction.includes(GOLDEN_FREEFORM_VIDEO_REQUEST)) return { mediaType: 'image', status: 'ready', limit: 6 }
    if (instruction.includes(GOLDEN_FREEFORM_AUDIO_REQUEST)) return { mediaType: 'video', status: 'ready', limit: 6 }
    if (instruction.includes(GOLDEN_FREEFORM_ADOPT_REQUEST)) return { mediaType: 'image', status: 'ready', limit: 6 }
  }
  if (toolName === 'create_video' && instruction.includes(GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST)) {
    return {
      request: {
        kind: 'new',
        count: 1,
        prompt: 'A slow cinematic push through a moonlit empty gallery.',
        durationSeconds: 15,
      },
    }
  }
  if (toolName === 'create_video' && instruction.includes(GOLDEN_FREEFORM_VIDEO_REQUEST)) {
    return {
      request: {
        kind: 'new',
        count: 2,
        prompt: 'Animate the referenced image with slow drifting mist and a gentle camera push.',
        mediaReferences: resourceReferences(request, 'image').slice(0, 1),
        durationSeconds: 15,
      },
    }
  }
  if (toolName === 'create_audio' && instruction.includes(GOLDEN_FREEFORM_AUDIO_REQUEST)) {
    return {
      request: {
        kind: 'new',
        count: 1,
        prompt: 'Compose restrained atmospheric music matching the referenced videos.',
        durationSeconds: 120,
        contextReferences: resourceReferences(request, 'video').slice(0, 3),
      },
    }
  }
  if (toolName === 'adopt_resource' && instruction.includes(GOLDEN_FREEFORM_ADOPT_REQUEST)) {
    const selected = listedResourceRecords(request)
      .filter((resource) => resource.mediaType === 'image' && resource.status === 'ready')
      .sort((left, right) => Number(left.candidateIndex ?? 0) - Number(right.candidateIndex ?? 0))[1]
    const revision = asRecord(selected?.headRevision)
    if (typeof selected?.resourceId !== 'string' || typeof revision?.revisionId !== 'string') {
      throw new Error('GOLDEN_FREEFORM_ADOPT_RESOURCE_MISSING')
    }
    return {
      resourceId: selected.resourceId,
      revisionId: revision.revisionId,
      role: 'primary_image',
      slotKey: 'main',
    }
  }
  if (toolName === 'delegate_creative_work' && instruction.includes(GOLDEN_FREEFORM_SCREENPLAY_REQUEST)) {
    return {
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'golden-screenplay-draft',
          outputKind: 'screenplay_draft',
          goal: 'Write one complete 240-second screenplay in one uninterrupted dramatic context.',
          targetDurationSeconds: 240,
          context: {
            userRequest: GOLDEN_FREEFORM_SCREENPLAY_REQUEST,
            sourceMaterials: [],
            constraints: [
              'Keep one continuous setting and dramatic context.',
              'Do not create or imply Chapter production units.',
            ],
          },
        }],
      },
    }
  }
  if (toolName === 'delegate_creative_work' && instruction.includes(GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST)) {
    return {
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'golden-style-bible',
          outputKind: 'style_bible',
          goal: 'Design one final textual Style Bible without generating any preview image.',
          context: {
            userRequest: GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST,
            sourceMaterials: [],
            constraints: ['Return textual visual rules only. Do not request or create preview media.'],
          },
        }],
      },
    }
  }
  if (toolName === 'list_resources' && (
    instruction.includes(GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST)
    || instruction.includes(GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST)
    || instruction.includes(GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST)
  )) {
    return { mediaType: 'text', status: 'ready', limit: 20 }
  }
  if (toolName === 'request_choice' && instruction.includes(GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST)) {
    const style = exactResourceRevision(resourceBySchema(request, 'project.style_bible'))
    return {
      subject: {
        kind: 'resource_revisions',
        revisions: [{ resourceId: style.resourceId, revisionId: style.revisionId }],
      },
      card: {
        mode: 'select',
        replyMode: 'none',
        title: '是否采用当前 Style Bible？',
        description: '这里只决定当前视觉规则是否成为项目采用版本。',
        groups: [{
          key: 'styleDecision',
          label: '当前决定',
          required: true,
          presentation: 'options',
          options: [
            {
              value: 'adopt',
              label: '采用这份 Style Bible',
              description: '仅更新当前项目的视觉规则绑定。',
            },
            {
              value: 'keep_unadopted',
              label: '暂不采用',
              description: '保留为普通创作资源。',
            },
          ],
        }],
        submitLabel: '提交本次视觉风格选择',
      },
      commitments: [{
        when: { kind: 'option', groupKey: 'styleDecision', optionValue: 'adopt' },
        operationId: 'adopt_style_bible',
        inputJson: JSON.stringify({ ...style, expectedVersion: null }),
      }],
    }
  }
  if (toolName === 'delegate_creative_work' && instruction.includes(GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST)) {
    const screenplayResource = resourceBySchema(request, 'project.source_script')
    const screenplay = exactResourceRevision(screenplayResource)
    return {
      delegation: {
        source: 'requests',
        requests: [{
          requestKey: 'golden-chapter-plan',
          outputKind: 'chapter_plan',
          goal: 'Plan two independently recoverable production Chapters while preserving the continuous story context.',
          targetDurationSeconds: 240,
          context: {
            userRequest: GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST,
            sourceMaterials: [{
              label: 'Exact screenplay revision',
              kind: 'text',
              content: resourceText(screenplayResource),
              provenance: { kind: 'resource', ...screenplay },
            }],
            constraints: [
              'Create exactly two ordered, non-overlapping production units.',
              'Each Chapter must be at most 180 seconds.',
              'Do not reinterpret the Chapter boundary as a story discontinuity.',
            ],
          },
        }],
      },
    }
  }
  if (toolName === 'adopt_chapters' && instruction.includes(GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST)) {
    const screenplayResource = resourceBySchema(request, 'project.source_script')
    return {
      screenplay: exactResourceRevision(screenplayResource),
      chapterPlan: exactResourceRevision(resourceBySchema(request, 'project.chapter_plan')),
    }
  }
  const tool = request.tools?.find((candidate) => candidate.function.name === toolName)
  return generateGoldenStructuredValue(asRecord(tool?.function.parameters))
}

function selectGenericTool(request: GoldenChatCompletionRequest): string | null {
  const available = availableToolNames(request)
  const alreadyCalled = new Set<string>()
  request.messages.forEach((message) => {
    if (!Array.isArray(message.tool_calls)) return
    message.tool_calls.forEach((toolCall) => {
      const name = asRecord(asRecord(toolCall)?.function)?.name
      if (typeof name === 'string') alreadyCalled.add(name)
    })
  })
  return ['request_choice', 'delegate_creative_work', 'create_text', 'create_image', 'create_video', 'create_audio']
    .find((toolName) => available.has(toolName) && !alreadyCalled.has(toolName)) ?? null
}

export function decideGoldenModelResponse(input: {
  readonly scenarioId: string
  readonly request: GoldenChatCompletionRequest
  readonly requestOrdinal: number
}): GoldenModelDecision {
  const structuredText = generateGoldenResponseFormatText(input.request.responseFormat)
  if (structuredText) {
    const available = availableToolNames(input.request)
    const called = allCalledTools(input.request)
    if (available.has('read_skill') && !called.has('read_skill')) {
      const text = messageText(input.request)
      const skillId = text.includes('style_bible') ? 'style-development' : 'story-development'
      return {
        kind: 'tool_call',
        toolCallId: `golden_call_${input.requestOrdinal}_read_skill`,
        toolName: 'read_skill',
        argumentsJson: JSON.stringify({ skillId }),
      }
    }
    return { kind: 'text', text: structuredText }
  }

  const instruction = latestFreeformInstruction(input.request)
  if (instruction?.text.includes(GOLDEN_STOP_REPLY_REQUEST)) {
    return { kind: 'text', text: `STOP_REPLY_STREAM_BEGIN ${'deterministic-stream-chunk '.repeat(200)}` }
  }
  if (instruction?.text.includes(GOLDEN_STOP_RECOVERY_REQUEST)) {
    return { kind: 'text', text: 'STOP_REPLY_RECOVERY_COMPLETED' }
  }
  if (instruction?.text.includes(GOLDEN_PARALLEL_IMAGE_REQUEST)) {
    const called = calledToolsAfter(input.request, instruction.index)
    if (currentProjectVideoRatio(input.request) === null && !called.has('request_choice')) {
      return {
        kind: 'tool_call',
        toolCallId: `golden_call_${input.requestOrdinal}_request_choice`,
        toolName: 'request_choice',
        argumentsJson: JSON.stringify(buildToolArguments(input.request, 'request_choice')),
      }
    }
    const alreadyCalled = called.has('create_image')
    const isTaskContinuation = messageText(input.request).includes('[task_update]')
    if (isTaskContinuation || alreadyCalled || !availableToolNames(input.request).has('create_image')) {
      return { kind: 'text', text: 'The three image submissions are accepted.' }
    }
    const prompts = [
      'A single stylized folk-horror guardian character on a plain dark background.',
      'An empty stylized mountain shrine at night with red lanterns and dense mist.',
      'A single ancient bronze ritual bell isolated on a plain dark background.',
    ]
    return {
      kind: 'tool_calls',
      calls: prompts.map((prompt, index) => ({
        toolCallId: `golden_call_${input.requestOrdinal}_create_image_${String(index + 1)}`,
        toolName: 'create_image',
        argumentsJson: JSON.stringify({
          request: { kind: 'new', count: 1, prompt },
        }),
      })),
    }
  }
  if (latestToolResultSubmittedTasks(input.request)) {
    return { kind: 'text', text: 'The background Task was submitted.' }
  }
  const selected = selectFreeformTool(input.request)
  const toolName = selected === undefined ? selectGenericTool(input.request) : selected
  if (!toolName) return { kind: 'text', text: 'The deterministic test model reached a stable boundary.' }
  return {
    kind: 'tool_call',
    toolCallId: `golden_call_${input.requestOrdinal}_${toolName}`,
    toolName,
    argumentsJson: JSON.stringify(buildToolArguments(input.request, toolName)),
  }
}
