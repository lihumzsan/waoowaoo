import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { ProjectAgentLocale } from './locale'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentChoiceCardGroup,
} from './types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'

const STYLE_PREVIEW_COUNT = 3
const STYLE_PREVIEW_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60
const EDIT_FIRST_ASPECT_RATIOS: readonly EditScriptVideoRatio[] = ['9:16', '16:9', '21:9']

export type EditFirstChoiceType = 'duration_and_aspect_ratio' | 'screenplay_review' | 'style'

export function readEditFirstDurationSeconds(text: string): number | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  if (/半分钟/.test(normalized)) return 30
  if (/一分钟/.test(normalized)) return 60
  if (/(两分钟|二分钟)/.test(normalized)) return 120

  const durationMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(秒|s|sec|secs|second|seconds|分钟|minute|minutes|min|mins)/i)
  if (!durationMatch) return null
  const rawValue = Number(durationMatch[1])
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null
  const unit = durationMatch[2] ?? ''
  const seconds = /分钟|minute|minutes|min|mins/i.test(unit)
    ? rawValue * 60
    : rawValue
  return Math.round(seconds)
}

export function editFirstUserTextHasDuration(text: string): boolean {
  return readEditFirstDurationSeconds(text) !== null
}

export function readEditFirstAspectRatio(text: string): EditScriptVideoRatio | null {
  const normalized = text.trim()
  const ratio = EDIT_FIRST_ASPECT_RATIOS.find((candidate) => normalized.includes(candidate))
  return ratio ?? null
}

function buildDurationAndAspectRatioChoiceCard(params: {
  locale: ProjectAgentLocale
  projectId: string
}): ProjectAgentChoiceCardPartData {
  const { locale, projectId } = params
  const isEnglish = locale === 'en'
  return {
    cardId: 'edit-first-duration-aspect-ratio',
    title: isEnglish ? 'Choose Duration and Aspect Ratio' : '选择短片时长和画面比例',
    description: isEnglish
      ? 'Choose both before screenplay generation. The current test launch supports edit-first videos up to 120 seconds.'
      : '生成剧本前先同时确认这两项。当前测试上线支持生成两分钟以内的剪辑先行短片。',
    groups: [
      {
        key: 'durationSeconds',
        label: isEnglish ? 'Duration' : '时长',
        required: true,
        options: [
          {
            value: '30',
            label: isEnglish ? '30 seconds' : '30 秒',
            description: isEnglish ? 'Fast rhythm, minimal story beat.' : '节奏最快，只保留核心情节。',
          },
          {
            value: '60',
            label: isEnglish ? '60 seconds' : '60 秒',
            description: isEnglish ? 'Balanced one-minute short.' : '一分钟短片，叙事和节奏较均衡。',
          },
          {
            value: '90',
            label: isEnglish ? '90 seconds' : '90 秒',
            description: isEnglish ? 'More room for atmosphere and setup.' : '有更多铺垫和氛围空间。',
          },
          {
            value: '120',
            label: isEnglish ? '120 seconds' : '120 秒',
            description: isEnglish ? 'Maximum duration for this test launch.' : '当前测试上线的最长时长。',
          },
        ],
      },
      buildAspectRatioGroup(locale),
    ],
    submitLabel: isEnglish ? 'Continue' : '继续生成',
    submit: {
      kind: 'set_project_video_ratio_and_send_message',
      projectId,
      messageTemplate: isEnglish
        ? 'I choose {durationSeconds} seconds and aspect ratio {aspectRatio}. Continue generating the edit-first screenplay with these choices.'
        : '我选择 {durationSeconds} 秒和 {aspectRatio} 画面比例，请以这些选择继续生成剪辑先行剧本。',
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
            styleKey: 'asc',
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
    throw new Error('EDIT_FIRST_ASPECT_RATIO_REQUIRED: call request_edit_first_choice with choiceType=duration_and_aspect_ratio before style choice')
  }
  if (!screenplay) {
    throw new Error('EDIT_FIRST_CHOICE_SCREENPLAY_NOT_FOUND')
  }
  if (screenplay.status !== 'style_preview_ready') {
    throw new Error(`EDIT_FIRST_STYLE_CHOICE_NOT_READY:screenplayStatus=${screenplay.status}`)
  }
  if (screenplay.stylePreviews.length < STYLE_PREVIEW_COUNT) {
    throw new Error(`EDIT_FIRST_STYLE_CHOICE_NOT_READY:readyStylePreviewCount=${String(screenplay.stylePreviews.length)}`)
  }

  const isEnglish = params.locale === 'en'
  return {
    cardId: `edit-first-style:${screenplay.id}`,
    title: isEnglish ? 'Choose Visual Style' : '选择视觉风格',
    description: isEnglish
      ? `Choose one style candidate before generating the director decoupage. The selected aspect ratio is ${selectedAspectRatio}.`
      : `请先选择一个风格候选，再继续生成导演拆镜。已选画面比例为 ${selectedAspectRatio}。`,
    groups: [
      {
        key: 'stylePreviewId',
        label: isEnglish ? 'Visual Style' : '视觉风格',
        required: true,
        options: screenplay.stylePreviews.slice(0, STYLE_PREVIEW_COUNT).map((preview, index) => ({
          value: preview.id,
          label: `${String.fromCharCode(65 + index)} · ${preview.title}`,
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
      successMessageTemplate: isEnglish
        ? `Selected style {stylePreviewIdLabel} and aspect ratio ${selectedAspectRatio}. Read the latest project state and continue with the immediate next step.`
        : `已选择风格 {stylePreviewIdLabel} 和画面比例 ${selectedAspectRatio}，请读取最新项目状态并继续当前唯一下一步。`,
    },
  }
}

function buildScreenplayReviewChoiceCard(params: {
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
}): ProjectAgentChoiceCardPartData {
  if (params.workflow.stage !== 'screenplay_ready_for_review') {
    throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=screenplay_review:stage=${params.workflow.stage}`)
  }
  const isEnglish = params.locale === 'en'
  return {
    cardId: 'edit-first-screenplay-review',
    variant: 'confirm_or_reply',
    title: isEnglish ? 'Review Screenplay' : '审核剧本',
    description: isEnglish
      ? 'Confirm to continue to visual style candidates, or send notes for a screenplay revision.'
      : '确认后继续生成视觉风格候选；也可以提交其他想法来修改剧本。',
    groups: [],
    submitLabel: isEnglish ? 'Confirm' : '确认',
    submit: {
      kind: 'send_message',
      messageTemplate: isEnglish
        ? 'I approve the current edit-first screenplay. Read the latest project state and continue with the immediate next step: generate visual style candidates.'
        : '我确认当前剪辑先行剧本，请读取最新项目状态，并继续当前唯一下一步：生成视觉风格候选图。',
    },
    replyLabel: isEnglish ? 'Other ideas' : '其他想法',
    replyPlaceholder: isEnglish
      ? 'Describe what you want changed in the screenplay...'
      : '输入你希望修改的剧情、氛围、角色、结尾或表达方向...',
    replySubmitLabel: isEnglish ? 'Submit notes' : '提交想法',
    replyMessageTemplate: isEnglish
      ? 'I have revision notes for the current edit-first screenplay: {replyText}'
      : '我对当前剪辑先行剧本有修改意见：{replyText}',
  }
}

export async function buildEditFirstAssistantChoiceCard(params: {
  projectId: string
  userId: string
  episodeId: string
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  choiceType: EditFirstChoiceType
}): Promise<ProjectAgentChoiceCardPartData> {
  if (params.choiceType === 'duration_and_aspect_ratio') {
    if (params.workflow.stage !== 'ready_to_generate_screenplay') {
      throw new Error(`EDIT_FIRST_CHOICE_NOT_ALLOWED:choiceType=duration_and_aspect_ratio:stage=${params.workflow.stage}`)
    }
    return buildDurationAndAspectRatioChoiceCard({
      locale: params.locale,
      projectId: params.projectId,
    })
  }

  if (params.choiceType === 'screenplay_review') {
    return buildScreenplayReviewChoiceCard({
      locale: params.locale,
      workflow: params.workflow,
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
  })
}
