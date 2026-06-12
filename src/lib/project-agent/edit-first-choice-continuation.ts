import { randomUUID } from 'node:crypto'
import type { AgentInputItem } from '@openai/agents'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { EditFirstChoiceType } from './choice-card'

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
  /**
   * Synthetic function_call/function_call_result pair injected into the next
   * run input so the model sees its own choice request answered in-band,
   * instead of receiving the choice through system-prompt prose.
   */
  inputItems: AgentInputItem[]
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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

function buildDurationAndAspectRatioInstruction(params: {
  userPrompt: string
  durationSeconds: number
  aspectRatio: EditScriptVideoRatio
}): string {
  return [
    '剪辑先行选择卡已经返回用户选择。',
    `用户原始创意需求：${JSON.stringify(params.userPrompt)}`,
    `用户已选择：durationSeconds=${String(params.durationSeconds)}，aspectRatio=${params.aspectRatio}。`,
    '本轮目标是生成剧本。必须先用一句用户可见自然语言承接用户选择，说明将基于所选时长和画面比例开始生成剧本；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '说明后调用 generate_edit_screenplay，并传入 prompt、durationSeconds、aspectRatio。',
    '不要再次调用 request_edit_first_choice 获取时长和画面比例，不要再次说明选择卡已经准备好，也不要要求用户手动输入确认。',
    'generate_edit_screenplay 成功后，仍然必须调用 request_edit_first_choice 并传 choiceType="screenplay_review"，用于展示剧本审核卡。',
  ].join('\n')
}

function buildScreenplayApprovedInstruction(): string {
  return [
    '剧本审核卡已经返回用户确认。',
    '本轮目标是生成视觉风格候选。必须先用一句用户可见自然语言说明将基于已确认剧本继续准备视觉方向；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '说明后调用 generate_edit_style_previews。',
    '不要再次调用 request_edit_first_choice，不要要求用户手动回复确认，也不要只输出说明文字。',
  ].join('\n')
}

function buildScreenplayRevisionInstruction(revisionNotes: string): string {
  return [
    '剧本审核卡已经返回用户修改意见。',
    `用户修改意见：${JSON.stringify(revisionNotes)}`,
    '本轮目标是修改剧本。必须先用一句用户可见自然语言说明将按用户修改意见更新当前剧本；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '说明后调用 revise_edit_screenplay，并把用户修改意见传入 revisionInstruction。',
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
    '本轮目标是生成导演拆镜。必须先用一句用户可见自然语言说明将基于已选视觉风格继续生成导演拆镜；不要提内部 operation 名、tool id、workflow 门禁或审批实现细节。',
    '说明后调用 generate_edit_director_decoupage。',
    '不要再次调用 request_edit_first_choice，不要要求用户手动输入风格，也不要只输出说明文字。',
  ].join('\n')
}

function buildChoiceInputItems(params: {
  toolCallId: string | null
  choiceType: EditFirstChoiceType
  result: UnknownRecord
  instruction: string
}): AgentInputItem[] {
  const callId = params.toolCallId ?? `edit_first_choice_${randomUUID()}`
  return [
    {
      type: 'function_call',
      callId,
      name: 'request_edit_first_choice',
      status: 'completed',
      arguments: JSON.stringify({ choiceType: params.choiceType }),
    } as AgentInputItem,
    {
      type: 'function_call_result',
      callId,
      name: 'request_edit_first_choice',
      status: 'completed',
      output: {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          choiceType: params.choiceType,
          ...params.result,
          instruction: params.instruction,
        }),
      },
    } as AgentInputItem,
  ]
}

export function resolveEditFirstChoiceContinuation(params: {
  choiceType: EditFirstChoiceType
  toolCallId: string | null
  output: UnknownRecord
  latestUserText: string
}): EditFirstChoiceContinuation | null {
  if (params.output.ok !== true && params.output.ok !== undefined) return null

  if (params.choiceType === 'duration_and_aspect_ratio') {
    const durationSeconds = readDurationSeconds(params.output)
    const aspectRatio = readAspectRatio(params.output.aspectRatio)
    if (!durationSeconds || !aspectRatio || !params.latestUserText) return null
    return {
      operationId: 'generate_edit_screenplay',
      inputItems: buildChoiceInputItems({
        toolCallId: params.toolCallId,
        choiceType: params.choiceType,
        result: { durationSeconds, aspectRatio },
        instruction: buildDurationAndAspectRatioInstruction({
          userPrompt: params.latestUserText,
          durationSeconds,
          aspectRatio,
        }),
      }),
    }
  }

  if (params.choiceType === 'screenplay_review') {
    const decision = readString(params.output.decision)
    if (decision === 'revise') {
      const revisionNotes = readString(params.output.revisionNotes) ?? readString(params.output.replyText)
      if (!revisionNotes) return null
      return {
        operationId: 'revise_edit_screenplay',
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'revise', revisionNotes },
          instruction: buildScreenplayRevisionInstruction(revisionNotes),
        }),
      }
    }
    if (decision === 'approve') {
      return {
        operationId: 'generate_edit_style_previews',
        inputItems: buildChoiceInputItems({
          toolCallId: params.toolCallId,
          choiceType: params.choiceType,
          result: { decision: 'approve' },
          instruction: buildScreenplayApprovedInstruction(),
        }),
      }
    }
    return null
  }

  const stylePreviewId = readString(params.output.stylePreviewId)
  const aspectRatio = readAspectRatio(params.output.aspectRatio)
  if (!stylePreviewId || !aspectRatio) return null
  return {
    operationId: 'generate_edit_director_decoupage',
    inputItems: buildChoiceInputItems({
      toolCallId: params.toolCallId,
      choiceType: params.choiceType,
      result: { stylePreviewId, aspectRatio, saved: true },
      instruction: buildStyleInstruction({ stylePreviewId, aspectRatio }),
    }),
  }
}
