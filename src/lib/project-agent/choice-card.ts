import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { ProjectAgentLocale } from './locale'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentChoiceCardGroup,
} from './types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import {
  EDIT_FIRST_DURATION_TIERS,
  readEditFirstDurationTierFromText,
  resolveEditFirstDurationSpec,
  type EditFirstDurationTier,
} from '@/lib/edit-script/duration-tier'
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

export function readEditFirstDurationTier(text: string): EditFirstDurationTier | null {
  return readEditFirstDurationTierFromText(text)
}

export function editFirstUserTextHasDuration(text: string): boolean {
  return readEditFirstDurationTier(text) !== null
}

export function readEditFirstAspectRatio(text: string): EditScriptVideoRatio | null {
  const normalized = text.trim()
  const ratio = EDIT_FIRST_ASPECT_RATIOS.find((candidate) => normalized.includes(candidate))
  return ratio ?? null
}

function buildDurationAndAspectRatioChoiceCard(params: {
  locale: ProjectAgentLocale
  projectId: string
  toolCallId: string
}): ProjectAgentChoiceCardPartData {
  const { locale, projectId, toolCallId } = params
  const isEnglish = locale === 'en'
  return {
    cardId: 'edit-first-duration-aspect-ratio',
    toolCallId,
    choiceType: 'duration_and_aspect_ratio',
    autoSubmitOnReady: true,
    title: isEnglish ? 'Choose Duration and Aspect Ratio' : '选择短片时长和画面比例',
    description: isEnglish
      ? 'Choose both before screenplay generation. The current test launch supports edit-first videos up to 120 seconds.'
      : '生成剧本前先同时确认这两项。当前测试上线支持生成两分钟以内的剪辑先行短片。',
    groups: [
      {
        key: 'durationTier',
        label: isEnglish ? 'Duration' : '时长',
        required: true,
        options: EDIT_FIRST_DURATION_TIERS.map((tier) => {
          const spec = resolveEditFirstDurationSpec(tier)
          return {
            value: tier,
            label: isEnglish
              ? `${spec.enLabel} · around ${String(spec.targetSeconds)} seconds`
              : `${spec.zhLabel} · 约 ${String(spec.targetSeconds)} 秒`,
            description: isEnglish ? spec.enGuidance : spec.zhGuidance,
          }
        }),
      },
      buildAspectRatioGroup(locale),
    ],
    submitLabel: isEnglish ? 'Continue' : '继续生成',
    submit: {
      kind: 'set_project_video_ratio',
      projectId,
    },
  }
}

function buildAspectRatioGroup(locale: ProjectAgentLocale): ProjectAgentChoiceCardGroup {
  const isEnglish = locale === 'en'
  return {
    key: 'aspectRatio',
    label: isEnglish ? 'Aspect Ratio' : '画面比例',
    required: true,
    options: [
      {
        value: '9:16',
        label: '9:16',
        description: isEnglish ? 'Vertical mobile-first format.' : '竖屏，适合移动端短视频。',
      },
      {
        value: '16:9',
        label: '16:9',
        description: isEnglish ? 'Standard widescreen format.' : '标准横屏，适合常规视频。',
      },
      {
        value: '21:9',
        label: '21:9',
        description: isEnglish ? 'Cinematic ultrawide format.' : '电影宽银幕，更强调氛围。',
      },
    ],
  }
}

async function buildStyleAndRatioChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  toolCallId: string
}): Promise<ProjectAgentChoiceCardPartData> {
  const [project, screenplay] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: params.projectId,
        userId: params.userId,
      },
      select: {
        videoRatio: true,
      },
    }),
    prisma.projectEditScreenplay.findFirst({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        project: {
          userId: params.userId,
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
    throw new Error('EDIT_FIRST_ASPECT_RATIO_REQUIRED: call request_edit_duration_aspect_ratio_choice before style choice')
  }
  if (!screenplay) {
    throw new Error('EDIT_FIRST_CHOICE_SCREENPLAY_NOT_FOUND')
  }
  if (screenplay.status !== 'style_preview_ready') {
    throw new Error(`EDIT_FIRST_STYLE_CHOICE_NOT_READY:screenplayStatus=${screenplay.status}`)
  }
  if (screenplay.stylePreviews.length < 1) {
    throw new Error(`EDIT_FIRST_STYLE_CHOICE_NOT_READY:readyStylePreviewCount=${String(screenplay.stylePreviews.length)}`)
  }

  const isEnglish = params.locale === 'en'
  return {
    cardId: `edit-first-style:${screenplay.id}`,
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
        options: screenplay.stylePreviews.map((preview, index) => ({
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

function buildScreenplayReviewChoiceCard(params: {
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  toolCallId: string
}): ProjectAgentChoiceCardPartData {
  if (params.workflow.stage !== 'screenplay_ready_for_review') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=screenplay_review:stage=${params.workflow.stage}`)
  }
  const isEnglish = params.locale === 'en'
  return {
    cardId: 'edit-first-screenplay-review',
    toolCallId: params.toolCallId,
    choiceType: 'screenplay_review',
    variant: 'confirm_or_reply',
    title: isEnglish ? 'Review Screenplay' : '审核剧本',
    groups: [],
    submitLabel: isEnglish ? 'Confirm' : '确认',
    submit: {
      kind: 'submit_tool_output',
    },
    replyLabel: isEnglish ? 'Other ideas' : '其他想法',
    replyPlaceholder: isEnglish
      ? 'Describe what you want changed in the screenplay...'
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

export async function buildEditFirstAssistantChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  choiceType: EditFirstChoiceType
  toolCallId: string
}): Promise<ProjectAgentChoiceCardPartData> {
  if (params.choiceType === 'duration_and_aspect_ratio') {
    if (params.workflow.stage !== 'ready_to_generate_screenplay') {
      throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=duration_and_aspect_ratio:stage=${params.workflow.stage}`)
    }
    return buildDurationAndAspectRatioChoiceCard({
      locale: params.locale,
      projectId: params.projectId,
      toolCallId: params.toolCallId,
    })
  }

  if (params.choiceType === 'screenplay_review') {
    return buildScreenplayReviewChoiceCard({
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
