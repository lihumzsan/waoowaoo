import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { ProjectAgentLocale } from './locale'
import type {
  ProjectAgentChoiceCardPartData,
} from './types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
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
const EDIT_FIRST_ASPECT_RATIOS: readonly EditScriptVideoRatio[] = ['9:16', '16:9', '21:9']
const BUDGET_CONFIRMATION_ALLOWED_STAGES = new Set<string>([
  'ready_to_generate_edit_script',
  'ready_to_generate_assets',
  'ready_to_generate_shot_execution_plan',
  'ready_to_generate_storyboard',
  'ready_to_generate_storyboard_images',
  'ready_to_generate_videos',
  'ready_to_render_chapters',
  'ready_to_generate_bgm_score',
  'ready_to_render_final',
])

export function readEditFirstAspectRatio(text: string): EditScriptVideoRatio | null {
  const normalized = text.trim()
  const ratio = EDIT_FIRST_ASPECT_RATIOS.find((candidate) => normalized.includes(candidate))
  return ratio ?? null
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
    title: isEnglish ? 'Review Bible' : '审核剧本',
    groups: [],
    submitLabel: isEnglish ? 'Confirm' : '确认',
    submit: {
      kind: 'submit_tool_output',
    },
    replyLabel: isEnglish ? 'Other ideas' : '其他想法',
    replyPlaceholder: isEnglish
      ? 'Describe what you want changed in the bible...'
      : '输入你希望修改的剧情、氛围、角色、结尾或表达方向...',
    replySubmitLabel: isEnglish ? 'Submit notes' : '提交想法',
    replyToolOutputKey: 'revisionNotes',
  }
}

function buildAssetReviewChoiceCard(params: {
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  toolCallId: string
}): ProjectAgentChoiceCardPartData {
  if (params.workflow.stage !== 'assets_ready_for_review') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=asset_review:stage=${params.workflow.stage}`)
  }
  const isEnglish = params.locale === 'en'
  return {
    cardId: 'edit-first-asset-review',
    toolCallId: params.toolCallId,
    choiceType: 'asset_review',
    variant: 'confirm_or_reply',
    title: isEnglish ? 'Review Required Assets' : '审核分镜资产',
    description: isEnglish
      ? 'Check the generated characters, locations, and spatial profiles. Continue only when the required assets look ready for shot planning.'
      : '请检查已生成的人物、场景和空间档案。确认满意后将继续生成镜头执行计划。',
    groups: [],
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

function buildBudgetConfirmationChoiceCard(params: {
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  toolCallId: string
}): ProjectAgentChoiceCardPartData {
  const nextAction = params.workflow.nextAction
  if (!nextAction || !BUDGET_CONFIRMATION_ALLOWED_STAGES.has(params.workflow.stage)) {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=budget_confirmation:stage=${params.workflow.stage}`)
  }
  const isEnglish = params.locale === 'en'
  return {
    cardId: `edit-first-budget:${params.workflow.stage}:${nextAction.operationId}`,
    toolCallId: params.toolCallId,
    choiceType: 'budget_confirmation',
    variant: 'confirm',
    title: isEnglish ? 'Confirm Production Budget' : '确认生产预算',
    description: isEnglish
      ? `Confirm this stage before the assistant starts ${nextAction.title}. The exact billable task submission still uses the project operation rules.`
      : `请确认这一阶段可以开始执行：${nextAction.title}。实际计费任务仍由项目 operation 规则提交和记录。`,
    groups: [],
    submitLabel: isEnglish ? 'Confirm and Continue' : '确认并继续',
    submit: {
      kind: 'submit_tool_output',
    },
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
  if (params.choiceType === 'bible_review') {
    return buildBibleReviewChoiceCard({
      locale: params.locale,
      workflow: params.workflow,
      toolCallId: params.toolCallId,
    })
  }

  if (params.choiceType === 'asset_review') {
    return buildAssetReviewChoiceCard({
      locale: params.locale,
      workflow: params.workflow,
      toolCallId: params.toolCallId,
    })
  }

  if (params.choiceType === 'budget_confirmation') {
    return buildBudgetConfirmationChoiceCard({
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
