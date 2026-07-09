import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Locale } from '@/i18n/routing'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { getProjectModelConfig } from '@/lib/config-service'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectAgentChoiceCardPartData, ProjectAgentChoiceCardGroup } from './types'
import type { ProjectAgentLocale } from './locale'

const SCRIPT_INTAKE_AI_FILL_VALUE = 'ai_fill'
const SCRIPT_INTAKE_MAX_SEED_LENGTH = 2000
const SCRIPT_INTAKE_RUNTIME_QUESTION_KEY = 'targetRuntime'

function buildRuntimeQuestion(locale: ProjectAgentLocale): ScriptIntakePlannerOutput['questions'][number] {
  const isEnglish = locale === 'en'
  return {
    key: SCRIPT_INTAKE_RUNTIME_QUESTION_KEY,
    label: isEnglish ? 'Target runtime' : '目标时长',
    options: isEnglish
      ? [
        { value: 'one_minute', label: '1 minute', description: 'Best for one sharp hook, one pressure scene, or a clean twist with no extra subplot.' },
        { value: 'three_minutes', label: '3 minutes', description: 'Enough for a clear setup, escalation, and payoff while keeping the story compact.' },
        { value: 'five_minutes', label: '5 minutes', description: 'Allows a fuller character goal, several beats of conflict, and a more complete ending.' },
        { value: 'ten_minutes', label: '10 minutes', description: 'Supports a broader arc with multiple scenes, richer relationships, and a slower build.' },
      ]
      : [
        { value: 'one_minute', label: '1分钟', description: '适合一个强钩子、一个高压场景或一次清晰反转，不展开支线。' },
        { value: 'three_minutes', label: '3分钟', description: '适合完整起承转合，能交代设定、升级冲突并完成收束。' },
        { value: 'five_minutes', label: '5分钟', description: '可以容纳更明确的人物目标、多段冲突推进和较完整的结尾。' },
        { value: 'ten_minutes', label: '10分钟', description: '适合多场景展开，更慢的铺垫、更丰富的人物关系和完整弧光。' },
      ],
  }
}

const scriptIntakeOptionSchema = z.object({
  value: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(180).optional().nullable(),
}).strict()

const scriptIntakeQuestionSchema = z.object({
  key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(80),
  options: z.array(scriptIntakeOptionSchema).min(2).max(6),
}).strict()

export const scriptIntakePlannerOutputSchema = z.object({
  questions: z.array(scriptIntakeQuestionSchema).min(2).max(7),
}).strict()

export type ScriptIntakePlannerOutput = z.infer<typeof scriptIntakePlannerOutputSchema>

const scriptIntakeChoiceCardSchema = z.object({
  cardId: z.string().min(1),
  runId: z.string().min(1).optional().nullable(),
  interruptionId: z.string().min(1).optional().nullable(),
  toolCallId: z.string().min(1),
  choiceType: z.literal('script_intake'),
  variant: z.literal('confirm_or_reply'),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  groups: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
    options: z.array(scriptIntakeOptionSchema.extend({
      imageUrl: z.string().optional().nullable(),
      meta: z.string().optional().nullable(),
    })),
  })),
  submitLabel: z.string().min(1),
  submit: z.object({
    kind: z.literal('submit_tool_output'),
  }),
  replyLabel: z.string().optional().nullable(),
  replyPlaceholder: z.string().optional().nullable(),
  replySubmitLabel: z.string().optional().nullable(),
  replyToolOutputKey: z.string().optional().nullable(),
}).passthrough()

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = readRecord(value)
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record)) {
    const text = readString(raw)
    if (text) result[key] = text
  }
  return result
}

function assertUnique(values: readonly string[], errorCode: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${errorCode}:${value}`)
    seen.add(value)
  }
}

function hasExplicitRuntime(seedText: string): boolean {
  const normalized = seedText.trim()
  if (!normalized) return false
  const digitRuntimePattern = /(?:\d+(?:\.\d+)?\s*(?:分钟|分|秒|小时|minute|minutes|min|mins|second|seconds|sec|secs|hour|hours)|\d+(?:\.\d+)?\s*-\s*(?:minute|minutes|min|mins|second|seconds|sec|secs|hour|hours))/iu
  if (digitRuntimePattern.test(normalized)) return true
  const englishWordRuntimePattern = /\b(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)(?:\s|-)*(?:minute|minutes|min|mins|second|seconds|sec|secs|hour|hours)|an?\s+(?:minute|second|hour))\b/iu
  if (englishWordRuntimePattern.test(normalized)) return true
  return /[一二两三四五六七八九十百半]+\s*(?:分钟|分|秒|小时)/u.test(normalized)
}

function isRuntimeQuestion(question: ScriptIntakePlannerOutput['questions'][number]): boolean {
  const key = question.key.toLowerCase()
  if (
    key === SCRIPT_INTAKE_RUNTIME_QUESTION_KEY.toLowerCase()
    || key.includes('runtime')
    || key.includes('duration')
    || key.includes('length')
  ) {
    return true
  }
  return /时长|片长|分钟|runtime|duration|length/i.test(question.label)
}

function ensureRuntimeQuestion(input: {
  readonly plan: ScriptIntakePlannerOutput
  readonly seedText: string
  readonly locale: ProjectAgentLocale
}): ScriptIntakePlannerOutput {
  const runtimeQuestion = buildRuntimeQuestion(input.locale)
  const explicitRuntime = hasExplicitRuntime(input.seedText)
  if (explicitRuntime) {
    const withoutRuntimeQuestion = input.plan.questions.filter((question) => !isRuntimeQuestion(question))
    return { questions: withoutRuntimeQuestion }
  }

  const runtimeQuestionIndex = input.plan.questions.findIndex(isRuntimeQuestion)
  if (runtimeQuestionIndex >= 0) {
    return {
      questions: input.plan.questions.map((question, index) => (
        index === runtimeQuestionIndex ? runtimeQuestion : question
      )).filter((question, index, questions) => (
        !isRuntimeQuestion(question) || questions.findIndex(isRuntimeQuestion) === index
      )),
    }
  }

  return {
    questions: [
      runtimeQuestion,
      ...input.plan.questions.slice(0, 6),
    ],
  }
}

export function validateScriptIntakePlannerOutput(output: ScriptIntakePlannerOutput): ScriptIntakePlannerOutput {
  assertUnique(output.questions.map((question) => question.key), 'SCRIPT_INTAKE_QUESTION_KEY_DUPLICATE')
  for (const question of output.questions) {
    assertUnique(question.options.map((option) => option.value), `SCRIPT_INTAKE_OPTION_VALUE_DUPLICATE:${question.key}`)
    if (question.options.some((option) => option.value === SCRIPT_INTAKE_AI_FILL_VALUE)) {
      throw new Error(`SCRIPT_INTAKE_AI_FILL_OPTION_FORBIDDEN:${question.key}`)
    }
  }
  return output
}

function buildScriptIntakeCardId(seedText: string, questions: readonly ScriptIntakePlannerOutput['questions'][number][]): string {
  const hash = createHash('sha256')
    .update(seedText)
    .update(JSON.stringify(questions.map((question) => ({
      key: question.key,
      options: question.options.map((option) => option.value),
    }))))
    .digest('hex')
    .slice(0, 12)
  return `script-intake:${hash}`
}

function buildScriptIntakeGroups(plan: ScriptIntakePlannerOutput): ProjectAgentChoiceCardGroup[] {
  return plan.questions.map((question) => ({
    key: question.key,
    label: question.label,
    required: true,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description ?? null,
    })),
  }))
}

export function buildScriptIntakeChoiceCard(params: {
  readonly locale: ProjectAgentLocale
  readonly workflow: EditFirstWorkflowState
  readonly toolCallId: string
  readonly seedText: string
  readonly plan: ScriptIntakePlannerOutput
}): ProjectAgentChoiceCardPartData {
  if (params.workflow.stage !== 'ready_to_ingest_script') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=script_intake:stage=${params.workflow.stage}`)
  }
  const seedText = params.seedText.trim()
  if (!seedText) throw new Error('SCRIPT_INTAKE_SEED_TEXT_REQUIRED')
  const plan = validateScriptIntakePlannerOutput(ensureRuntimeQuestion({
    plan: validateScriptIntakePlannerOutput(params.plan),
    seedText,
    locale: params.locale,
  }))
  const isEnglish = params.locale === 'en'
  return {
    cardId: buildScriptIntakeCardId(seedText, plan.questions),
    toolCallId: params.toolCallId,
    choiceType: 'script_intake',
    variant: 'confirm_or_reply',
    autoSubmitOnReady: true,
    title: isEnglish ? 'Refine the story brief' : '补充创作方向',
    description: isEnglish
      ? 'Choose a few directions before the system expands this idea into a full script.'
      : '在系统扩写完整剧本前，先选择几个创作方向。',
    groups: buildScriptIntakeGroups(plan),
    submitLabel: isEnglish ? 'Use these choices' : '使用这些选择',
    submit: {
      kind: 'submit_tool_output',
    },
    replyLabel: isEnglish ? 'Or write your own brief' : '或直接补充你的想法',
    replyPlaceholder: isEnglish
      ? 'Add story details, tone, characters, location, or anything the choices do not cover...'
      : '补充故事设定、氛围、人物、地点，或选项没有覆盖的内容...',
    replySubmitLabel: isEnglish ? 'Use this brief' : '使用这段补充',
    replyToolOutputKey: 'freeText',
  }
}

export function readPersistedScriptIntakeChoiceCard(value: unknown): ProjectAgentChoiceCardPartData | null {
  const parsed = scriptIntakeChoiceCardSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data as ProjectAgentChoiceCardPartData
}

export async function planScriptIntakeQuestions(input: {
  readonly userId: string
  readonly projectId: string
  readonly locale: Locale
  readonly seedText: string
}): Promise<ScriptIntakePlannerOutput> {
  const seedText = input.seedText.trim()
  if (!seedText) throw new Error('SCRIPT_INTAKE_SEED_TEXT_REQUIRED')
  if (seedText.length > SCRIPT_INTAKE_MAX_SEED_LENGTH) {
    throw new Error(`SCRIPT_INTAKE_SEED_TEXT_TOO_LONG:${String(seedText.length)}`)
  }
  const config = await getProjectModelConfig(input.projectId, input.userId)
  if (!config.analysisModel) {
    throw new Error('SCRIPT_INTAKE_ANALYSIS_MODEL_REQUIRED')
  }
  const prompt = buildAiPrompt({
    promptId: AI_PROMPT_IDS.PROJECT_AGENT_SCRIPT_INTAKE,
    locale: input.locale,
    variables: {
      seed_text: seedText,
    },
  })
  const result = await executeAiStructuredTextStep({
    userId: input.userId,
    model: config.analysisModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    projectId: input.projectId,
    action: AI_PROMPT_IDS.PROJECT_AGENT_SCRIPT_INTAKE,
    locale: input.locale,
    meta: {
      stepId: AI_PROMPT_IDS.PROJECT_AGENT_SCRIPT_INTAKE,
      stepTitle: 'Plan script intake questions',
      stepIndex: 1,
      stepTotal: 1,
    },
    schema: scriptIntakePlannerOutputSchema,
    parse: { kind: 'object' },
    validate: validateScriptIntakePlannerOutput,
  })
  return result.data
}

function readSelectedChoiceLabels(output: Record<string, unknown>): string[] {
  const selections = readStringRecord(output.selections)
  const labels = readStringRecord(output.labels)
  return Object.entries(selections).flatMap(([key]) => {
    const label = labels[`${key}Label`]
    return label ? [label] : []
  })
}

export function normalizeScriptIntakeChoiceBrief(input: {
  readonly seedText: string
  readonly output: Record<string, unknown>
}): string | null {
  if (input.output.ok !== true && input.output.ok !== undefined) return null
  const seedText = input.seedText.trim()
  const freeText = readString(input.output.freeText) ?? readString(input.output.replyText)
  const choiceLabels = readSelectedChoiceLabels(input.output)
  const lines: string[] = []
  if (seedText) lines.push(seedText)
  for (const label of choiceLabels) {
    if (!lines.includes(label)) lines.push(`- ${label}`)
  }
  if (freeText && !lines.includes(freeText)) lines.push(freeText)
  const brief = lines.join('\n').trim()
  return brief || null
}
