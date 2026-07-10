import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { ProjectAgentLocale } from './locale'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentChoiceCardOption,
} from './types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { EDIT_SCRIPT_VIDEO_RATIOS, type EditScriptVideoRatio } from '@/lib/edit-script/types'
export {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  isEditFirstChoiceToolId,
} from './edit-first-choice-tools'
export type {
  EditFirstChoiceToolId,
  EditFirstChoiceType,
} from './edit-first-choice-tools'
import type { EditFirstChoiceType } from './edit-first-choice-tools'

const STYLE_PREVIEW_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60
const EDIT_FIRST_ASPECT_RATIOS: readonly EditScriptVideoRatio[] = EDIT_SCRIPT_VIDEO_RATIOS
export function readEditFirstAspectRatio(text: string): EditScriptVideoRatio | null {
  const normalized = text.trim()
  const ratio = EDIT_FIRST_ASPECT_RATIOS.find((candidate) => normalized.includes(candidate))
  return ratio ?? null
}

function buildAspectRatioOptions(isEnglish: boolean): ProjectAgentChoiceCardOption[] {
  return EDIT_FIRST_ASPECT_RATIOS.map((ratio) => ({
    value: ratio,
    label: ratio,
    description: isEnglish ? 'Project video aspect ratio' : '项目视频画面比例',
  }))
}

async function buildStyleAndRatioChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  toolCallId: string
}): Promise<ProjectAgentChoiceCardPartData> {
  const [project, editBible] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: params.projectId,
        userId: params.userId,
      },
      select: {
        videoRatio: true,
      },
    }),
    prisma.projectEditBible.findFirst({
      where: {
        episodeId: params.episodeId,
        episode: {
          projectId: params.projectId,
          project: {
            userId: params.userId,
          },
        },
      },
      select: {
        id: true,
        status: true,
        stylePreviews: {
          where: {
            status: {
              in: ['completed', 'confirmed'],
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            styleKey: true,
            title: true,
            summary: true,
            imageKey: true,
          },
        },
      },
    }),
  ])
  if (!project) {
    throw new Error('EDIT_FIRST_CHOICE_PROJECT_NOT_FOUND')
  }
  const selectedAspectRatio = EDIT_FIRST_ASPECT_RATIOS.find((ratio) => ratio === project.videoRatio)
  if (!selectedAspectRatio) {
    throw new Error('EDIT_FIRST_ASPECT_RATIO_REQUIRED: set project videoRatio before style choice')
  }
  if (!editBible) {
    throw new Error('EDIT_FIRST_CHOICE_BIBLE_NOT_FOUND')
  }
  if (editBible.stylePreviews.length < 1) {
    throw new Error(`EDIT_FIRST_STYLE_CHOICE_NOT_READY:readyStylePreviewCount=${String(editBible.stylePreviews.length)}:bibleStatus=${editBible.status}`)
  }

  const isEnglish = params.locale === 'en'
  return {
    cardId: `edit-first-style:${editBible.id}`,
    toolCallId: params.toolCallId,
    choiceType: 'style',
    title: isEnglish ? 'Choose Visual Style' : '选择视觉风格',
    description: isEnglish
      ? `Choose one style candidate before generating the core edit plan. The selected aspect ratio is ${selectedAspectRatio}.`
      : `请先选择一个风格候选，再继续生成核心剪辑计划。已选画面比例为 ${selectedAspectRatio}。`,
    groups: [
      {
        key: 'stylePreviewId',
        label: isEnglish ? 'Visual Style' : '视觉风格',
        required: true,
        options: editBible.stylePreviews.map((preview, index) => ({
          value: preview.id,
          label: `${isEnglish ? 'Candidate' : '候选'} ${String(index + 1)} · ${preview.title}`,
          description: preview.summary,
          imageUrl: preview.imageKey ? getSignedUrl(preview.imageKey, STYLE_PREVIEW_SIGNED_URL_SECONDS) : null,
          meta: preview.styleKey,
        })),
      },
    ],
    submitLabel: isEnglish ? 'Confirm and Continue' : '确认并继续',
    submit: {
      kind: 'confirm_edit_style_preview',
      projectId: params.projectId,
      episodeId: params.episodeId,
      aspectRatio: selectedAspectRatio,
    },
  }
}

async function buildScriptReviewChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  toolCallId: string
}): Promise<ProjectAgentChoiceCardPartData> {
  if (params.workflow.stage !== 'script_ready_for_review') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=script_review:stage=${params.workflow.stage}`)
  }
  const editBible = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: params.episodeId,
      episode: {
        projectId: params.projectId,
        project: { userId: params.userId },
      },
    },
    select: {
      id: true,
      status: true,
      version: true,
      sourceDocument: {
        select: {
          id: true,
          sourceKind: true,
          checksum: true,
          version: true,
          normalizedText: true,
        },
      },
    },
  })
  if (!editBible) {
    throw new Error('EDIT_FIRST_CHOICE_SCRIPT_NOT_FOUND')
  }
  if (editBible.status !== 'script_ready_for_review') {
    throw new Error(`EDIT_FIRST_SCRIPT_REVIEW_NOT_READY:${editBible.status}`)
  }
  if (editBible.sourceDocument.sourceKind !== 'prompt_generated_script') {
    throw new Error(`EDIT_FIRST_SCRIPT_REVIEW_SOURCE_INVALID:${editBible.sourceDocument.sourceKind}`)
  }
  const isEnglish = params.locale === 'en'
  const scriptLength = editBible.sourceDocument.normalizedText.length
  const cardVersion = createHash('sha256')
    .update([
      editBible.id,
      String(editBible.version),
      editBible.sourceDocument.id,
      editBible.sourceDocument.checksum,
      String(editBible.sourceDocument.version),
    ].join('|'))
    .digest('hex')
    .slice(0, 12)
  return {
    cardId: `edit-first-script-review:${params.episodeId}:${cardVersion}`,
    toolCallId: params.toolCallId,
    choiceType: 'script_review',
    variant: 'confirm_or_reply',
    title: isEnglish ? 'Confirm Script' : '确认剧本',
    description: isEnglish
      ? `Confirm the generated source script before production planning. Current script length: ${String(scriptLength)} characters.`
      : `请先确认生成后的完整源剧本，再进入制作规划。当前剧本文本约 ${String(scriptLength)} 字。`,
    groups: [],
    submitLabel: isEnglish ? 'Approve Script and Generate Production Plan' : '确认剧本，生成制作规划',
    submit: {
      kind: 'submit_tool_output',
    },
    replyLabel: isEnglish ? 'Request changes' : '需要修改',
    replyPlaceholder: isEnglish
      ? 'Describe what should change in the generated script...'
      : '输入你希望调整的剧情、人物、结构、风格或结局...',
    replySubmitLabel: isEnglish ? 'Submit script changes' : '提交剧本修改意见',
    replyToolOutputKey: 'revisionNotes',
  }
}

function buildBibleReviewChoiceCard(params: {
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  toolCallId: string
}): ProjectAgentChoiceCardPartData {
  if (params.workflow.stage !== 'bible_ready_for_review') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=bible_review:stage=${params.workflow.stage}`)
  }
  const isEnglish = params.locale === 'en'
  return {
    cardId: 'edit-first-bible-review',
    toolCallId: params.toolCallId,
    choiceType: 'bible_review',
    variant: 'confirm_or_reply',
    title: isEnglish ? 'Confirm Production Plan' : '确认制作规划',
    description: isEnglish
      ? 'Review the story understanding, chapter split, durable facts, emotional curve, and choose the project aspect ratio. Confirm only when this production plan can drive chapter production.'
      : '请审核系统对整集剧本的理解、章节切分、长期事实和情绪走势，并选择项目画面比例。确认后，这份制作规划将作为各章节制作的基线。',
    groups: [
      {
        key: 'aspectRatio',
        label: isEnglish ? 'Aspect Ratio' : '画面比例',
        required: true,
        options: buildAspectRatioOptions(isEnglish),
      },
    ],
    submitLabel: isEnglish ? 'Confirm Production Plan' : '确认制作规划',
    submit: {
      kind: 'submit_tool_output',
    },
    replyLabel: isEnglish ? 'Request changes' : '需要修改',
    replyPlaceholder: isEnglish
      ? 'Describe what should change in the story understanding, chapter split, durable facts, or emotional direction...'
      : '输入你希望调整的故事理解、章节切分、长期事实或情绪方向...',
    replySubmitLabel: isEnglish ? 'Submit change request' : '提交修改意见',
    replyToolOutputKey: 'revisionNotes',
  }
}

function buildAssetReviewVersion(input: readonly {
  readonly id: string
  readonly updatedAt: Date
  readonly requirements: readonly {
    readonly id: string
    readonly status: string
    readonly targetId: string | null
  }[]
}[]): string {
  const source = input.map((script) => [
    script.id,
    script.updatedAt.toISOString(),
    script.requirements.map((requirement) => [
      requirement.id,
      requirement.status,
      requirement.targetId ?? '',
    ].join(':')).join(','),
  ].join('|')).join(';')
  return createHash('sha256').update(source).digest('hex').slice(0, 12)
}

async function buildAssetReviewChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  toolCallId: string
}): Promise<ProjectAgentChoiceCardPartData> {
  if (params.workflow.stage !== 'assets_ready_for_review') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=asset_review:stage=${params.workflow.stage}`)
  }
  const editScripts = await prisma.projectEditScript.findMany({
    where: {
      projectId: params.projectId,
      episodeId: params.episodeId,
      project: {
        userId: params.userId,
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      chapterId: true,
      updatedAt: true,
      requirements: {
        orderBy: [
          { kind: 'asc' },
          { name: 'asc' },
        ],
        select: {
          id: true,
          kind: true,
          name: true,
          status: true,
          targetId: true,
          errorMessage: true,
        },
      },
    },
  })
  if (editScripts.length === 0) {
    throw new Error(`EDIT_FIRST_ASSET_REVIEW_SCRIPT_REQUIRED:${params.episodeId}`)
  }
  const notReadyRequirements = editScripts.flatMap((script) =>
    script.requirements
      .filter((requirement) => requirement.status !== 'completed')
      .map((requirement) => `${script.chapterId ?? script.id}:${requirement.name}:${requirement.status}`))
  if (notReadyRequirements.length > 0) {
    throw new Error(`EDIT_FIRST_ASSET_REVIEW_ASSETS_NOT_READY:${notReadyRequirements.join(',')}`)
  }
  const isEnglish = params.locale === 'en'
  const version = buildAssetReviewVersion(editScripts)
  return {
    cardId: `edit-first-asset-review:${params.episodeId}:${version}`,
    toolCallId: params.toolCallId,
    choiceType: 'asset_review',
    variant: 'confirm_or_reply',
    title: isEnglish ? 'Review Required Assets' : '审核分镜资产',
    description: isEnglish
      ? 'Check the generated characters, locations, and spatial profiles. Continue only when the required assets look ready for shot planning.'
      : '请检查已生成的人物、场景和空间档案。确认满意后将继续生成镜头执行计划。',
    groups: [{
      key: 'assetSummary',
      label: isEnglish ? 'Ready assets' : '已就绪资产',
      required: false,
      options: editScripts.map((script, index) => ({
        value: script.id,
        label: isEnglish
          ? `Chapter ${String(index + 1)} · ${String(script.requirements.length)} asset(s)`
          : `第 ${String(index + 1)} 章 · ${String(script.requirements.length)} 个资产`,
        description: script.requirements.map((requirement) => `${requirement.name} / ${requirement.kind}`).join('\n'),
      })),
    }],
    submitLabel: isEnglish ? 'Assets Look Good' : '资产满意，继续',
    submit: {
      kind: 'submit_tool_output',
    },
    replyLabel: isEnglish ? 'Need changes' : '需要调整',
    replyPlaceholder: isEnglish
      ? 'Describe the character, location, spatial, or visual issues to adjust...'
      : '输入你希望调整的人物、场景、空间关系或视觉问题...',
    replySubmitLabel: isEnglish ? 'Submit changes' : '提交调整意见',
    replyToolOutputKey: 'revisionNotes',
  }
}

export async function buildEditFirstAssistantChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  choiceType: EditFirstChoiceType
  toolCallId: string
}): Promise<ProjectAgentChoiceCardPartData> {
  if (params.choiceType === 'script_intake') {
    throw new Error('SCRIPT_INTAKE_CHOICE_CARD_REQUIRES_PERSISTED_PAYLOAD')
  }

  if (params.choiceType === 'bible_review') {
    return buildBibleReviewChoiceCard({
      locale: params.locale,
      workflow: params.workflow,
      toolCallId: params.toolCallId,
    })
  }

  if (params.choiceType === 'script_review') {
    return await buildScriptReviewChoiceCard({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      locale: params.locale,
      workflow: params.workflow,
      toolCallId: params.toolCallId,
    })
  }

  if (params.choiceType === 'asset_review') {
    return await buildAssetReviewChoiceCard({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      locale: params.locale,
      workflow: params.workflow,
      toolCallId: params.toolCallId,
    })
  }

  if (params.workflow.stage === 'style_preview_generating') {
    throw new Error('EDIT_FIRST_STYLE_PREVIEW_NOT_READY:stage=style_preview_generating')
  }
  if (params.workflow.stage !== 'needs_style_choice') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=style:stage=${params.workflow.stage}`)
  }
  return await buildStyleAndRatioChoiceCard({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId,
    locale: params.locale,
    toolCallId: params.toolCallId,
  })
}
