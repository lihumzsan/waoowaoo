import type { UIMessage } from 'ai'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { ProjectAgentChoiceResponseData } from './types'

type ChoiceContinuationOperationId =
  | 'generate_edit_screenplay'
  | 'generate_edit_style_previews'
  | 'revise_edit_screenplay'
  | 'generate_edit_director_decoupage'

interface UnknownRecord {
  [key: string]: unknown
}

export interface EditFirstChoiceContinuation {
  operationId: ChoiceContinuationOperationId
  instruction: string
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTextPart(part: unknown): string {
  if (!isRecord(part)) return ''
  return part.type === 'text' && typeof part.text === 'string' ? part.text : ''
}

function readMessageText(message: UIMessage): string {
  return message.parts.map(readTextPart).join('').trim()
}

function readLatestUserTextBefore(messages: readonly UIMessage[], beforeIndex: number): string {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    const text = readMessageText(message)
    if (text) return text
  }
  return ''
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readAspectRatio(value: unknown): EditScriptVideoRatio | null {
  if (value === '9:16' || value === '16:9' || value === '21:9') return value
  return null
}

function readDurationSeconds(output: UnknownRecord): number | null {
  const direct = output.durationSeconds
  if (typeof direct === 'number' && Number.isInteger(direct) && direct > 0 && direct <= 120) return direct
  const selections = isRecord(output.selections) ? output.selections : null
  const selected = selections?.durationSeconds
  if (typeof selected === 'number' && Number.isInteger(selected) && selected > 0 && selected <= 120) return selected
  if (typeof selected === 'string') {
    const parsed = Number(selected)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 120) return parsed
  }
  return null
}

function parseChoiceResponseData(value: unknown): ProjectAgentChoiceResponseData | null {
  if (!isRecord(value)) return null
  if (!isRecord(value.output)) return null
  const toolCallId = value.toolCallId
  return {
    toolCallId: typeof toolCallId === 'string' ? toolCallId : null,
    output: value.output,
  }
}

function readChoiceResponseOutput(message: UIMessage): UnknownRecord | null {
  const metadata = message.metadata
  if (!isRecord(metadata)) return null
  const custom = metadata.custom
  if (!isRecord(custom)) return null
  const response = parseChoiceResponseData(custom.projectAgentChoiceResponse)
  return response?.output ?? null
}

function buildDurationAndAspectRatioInstruction(params: {
  userPrompt: string
  durationSeconds: number
  aspectRatio: EditScriptVideoRatio
}): string {
  return [
    '剪辑先行选择卡已经返回用户选择。',
    `用户原始创意需求：${JSON.stringify(params.userPrompt)}`,
    `用户已选择：durationSeconds=${String(params.durationSeconds)}，aspectRatio=${params.aspectRatio}。`,
    '调用下一步工具前，必须先用一句用户可见自然语言说明你将基于这些选择继续生成下一步内容；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '本轮必须直接调用 generate_edit_screenplay，并传入 prompt、durationSeconds、aspectRatio。',
    '不要再次调用 request_edit_first_choice 获取时长和画面比例，不要再次说明选择卡已经准备好，也不要要求用户手动输入确认。',
    'generate_edit_screenplay 成功后，仍然必须调用 request_edit_first_choice 并传 choiceType="screenplay_review"，用于展示剧本审核卡。',
  ].join('\n')
}

function buildScreenplayApprovedInstruction(): string {
  return [
    '剧本审核卡已经返回用户确认。',
    '调用下一步工具前，必须先用一句用户可见自然语言说明你将基于已确认剧本继续生成下一步内容；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '本轮必须直接调用 generate_edit_style_previews。',
    '不要再次调用 request_edit_first_choice，不要要求用户手动回复确认，也不要只输出说明文字。',
  ].join('\n')
}

function buildScreenplayRevisionInstruction(revisionNotes: string): string {
  return [
    '剧本审核卡已经返回用户修改意见。',
    `用户修改意见：${JSON.stringify(revisionNotes)}`,
    '调用下一步工具前，必须先用一句用户可见自然语言说明你将按用户修改意见更新当前内容；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '本轮必须直接调用 revise_edit_screenplay，并把用户修改意见传入 revisionInstruction。',
    '不要再次调用 request_edit_first_choice，不要把修改推迟到视觉风格阶段，也不要只输出说明文字。',
  ].join('\n')
}

function buildStyleInstruction(params: {
  stylePreviewId: string
  aspectRatio: EditScriptVideoRatio
}): string {
  return [
    '视觉风格选择卡已经返回用户选择，并且系统已经保存该风格选择。',
    `用户已选择：stylePreviewId=${params.stylePreviewId}，aspectRatio=${params.aspectRatio}。`,
    '调用下一步工具前，必须先用一句用户可见自然语言说明你将基于已选视觉风格继续生成下一步内容；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '本轮必须直接调用 generate_edit_director_decoupage。',
    '不要再次调用 request_edit_first_choice，不要要求用户手动输入风格，也不要只输出说明文字。',
  ].join('\n')
}

function resolveChoiceContinuationFromOutput(params: {
  output: UnknownRecord
  latestUserText: string
}): EditFirstChoiceContinuation | null {
  if (params.output.ok !== true) return null
  const choiceType = readString(params.output.choiceType)
  if (choiceType === 'duration_and_aspect_ratio') {
    const durationSeconds = readDurationSeconds(params.output)
    const aspectRatio = readAspectRatio(params.output.aspectRatio)
    if (!durationSeconds || !aspectRatio || !params.latestUserText) return null
    return {
      operationId: 'generate_edit_screenplay',
      instruction: buildDurationAndAspectRatioInstruction({
        userPrompt: params.latestUserText,
        durationSeconds,
        aspectRatio,
      }),
    }
  }

  if (choiceType === 'screenplay_review') {
    const decision = readString(params.output.decision)
    if (decision === 'revise') {
      const revisionNotes = readString(params.output.revisionNotes)
      if (!revisionNotes) return null
      return {
        operationId: 'revise_edit_screenplay',
        instruction: buildScreenplayRevisionInstruction(revisionNotes),
      }
    }
    if (decision === 'approve') {
      return {
        operationId: 'generate_edit_style_previews',
        instruction: buildScreenplayApprovedInstruction(),
      }
    }
  }

  if (choiceType === 'style') {
    const stylePreviewId = readString(params.output.stylePreviewId)
    const aspectRatio = readAspectRatio(params.output.aspectRatio)
    if (!stylePreviewId || !aspectRatio) return null
    return {
      operationId: 'generate_edit_director_decoupage',
      instruction: buildStyleInstruction({ stylePreviewId, aspectRatio }),
    }
  }

  return null
}

export function resolveEditFirstChoiceContinuation(
  messages: readonly UIMessage[],
): EditFirstChoiceContinuation | null {
  const latestMessageIndex = messages.length - 1
  const latestMessage = messages[latestMessageIndex]
  if (!latestMessage || latestMessage.role !== 'user') return null

  const output = readChoiceResponseOutput(latestMessage)
  if (!output) return null
  const latestUserText = readLatestUserTextBefore(messages, latestMessageIndex)
  return resolveChoiceContinuationFromOutput({
    output,
    latestUserText,
  })
}
