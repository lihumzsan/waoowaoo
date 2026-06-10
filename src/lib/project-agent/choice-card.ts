import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/storage'
import type { ProjectAgentLocale } from './locale'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentChoiceCardGroup,
} from './types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

const STYLE_PREVIEW_COUNT = 3
const STYLE_PREVIEW_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60

function requestedGroupsContainEditFirst(requestedGroups: ReadonlyArray<ReadonlyArray<string>>): boolean {
  return requestedGroups.some((groupPath) => groupPath[0] === 'edit-script')
}

export function editFirstUserTextHasDuration(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  if (/[0-9]+(?:\.[0-9]+)?\s*(秒|s|sec|secs|second|seconds|分钟|minute|minutes|min|mins)/i.test(normalized)) {
    return true
  }
  return /(半分钟|一分钟|两分钟|二分钟|30\s*秒|60\s*秒|90\s*秒|120\s*秒)/.test(normalized)
}

function buildDurationChoiceCard(locale: ProjectAgentLocale): ProjectAgentChoiceCardPartData {
  const isEnglish = locale === 'en'
  return {
    cardId: 'edit-first-duration',
    title: isEnglish ? 'Choose Short Film Duration' : '选择短片时长',
    description: isEnglish
      ? 'The current test launch supports edit-first videos up to 120 seconds.'
      : '当前测试上线支持生成两分钟以内的剪辑先行短片。',
    groups: [{
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
    }],
    submitLabel: isEnglish ? 'Continue' : '继续生成',
    submit: {
      kind: 'send_message',
      messageTemplate: isEnglish
        ? 'I choose {durationSeconds} seconds. Continue generating the edit-first screenplay with this duration.'
        : '我选择 {durationSeconds} 秒，请以这个时长继续生成剪辑先行剧本。',
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
}): Promise<ProjectAgentChoiceCardPartData | null> {
  const screenplay = await prisma.projectEditScreenplay.findFirst({
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
  })
  if (!screenplay || screenplay.status !== 'style_preview_ready') return null
  if (screenplay.stylePreviews.length < STYLE_PREVIEW_COUNT) return null

  const isEnglish = params.locale === 'en'
  return {
    cardId: `edit-first-style-ratio:${screenplay.id}`,
    title: isEnglish ? 'Choose Visual Style and Aspect Ratio' : '选择视觉风格和画面比例',
    description: isEnglish
      ? 'Choose one style candidate and one output aspect ratio before generating the director decoupage.'
      : '请先选择一个风格候选和一个输出画面比例，再继续生成导演拆镜。',
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
      buildAspectRatioGroup(params.locale),
    ],
    submitLabel: isEnglish ? 'Confirm and Continue' : '确认并继续',
    submit: {
      kind: 'confirm_edit_style_preview',
      projectId: params.projectId,
      episodeId: params.episodeId,
      successMessageTemplate: isEnglish
        ? 'Selected style {styleLabel} and aspect ratio {aspectRatio}. Read the latest project state and continue with the immediate next step.'
        : '已选择风格 {styleLabel} 和画面比例 {aspectRatio}，请读取最新项目状态并继续当前唯一下一步。',
    },
  }
}

export async function buildEditFirstAssistantChoiceCards(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  locale: ProjectAgentLocale
  workflow: EditFirstWorkflowState
  requestedGroups: ReadonlyArray<ReadonlyArray<string>>
  latestUserText: string
}): Promise<ProjectAgentChoiceCardPartData[]> {
  const workflowApplies = params.workflow.active || requestedGroupsContainEditFirst(params.requestedGroups)
  if (!workflowApplies) return []

  if (
    params.workflow.stage === 'ready_to_generate_screenplay'
    && !editFirstUserTextHasDuration(params.latestUserText)
  ) {
    return [buildDurationChoiceCard(params.locale)]
  }

  if (params.workflow.stage === 'needs_style_choice' && params.episodeId) {
    const styleCard = await buildStyleAndRatioChoiceCard({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId,
      locale: params.locale,
    })
    return styleCard ? [styleCard] : []
  }

  return []
}

export function choiceCardsBlockOperation(
  cards: readonly ProjectAgentChoiceCardPartData[],
  operationId: string,
): boolean {
  return cards.some((card) => {
    if (card.cardId === 'edit-first-duration') return operationId === 'generate_edit_screenplay'
    if (card.cardId.startsWith('edit-first-style-ratio:')) return operationId === 'generate_edit_director_decoupage'
    return false
  })
}
