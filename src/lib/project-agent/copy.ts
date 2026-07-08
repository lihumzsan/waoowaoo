import type { ProjectAgentLocale } from './locale'
import type { EditFirstWorkflowOperationId } from '@/lib/project-workflow/edit-first-operation-policy'

type ProjectAgentOperationTitleCopy = {
  zh: string
  en: string
}

const SELECTABLE_TOOL_DESCRIPTION_COPY: Record<string, { zh: string; en: string }> = {
  get_project_context: {
    zh: '读取项目或剧集的具体内容：完整 Bible 正文、历史生成结果、失败原因、正在运行的任务详情，以及资产、分镜、面板的字段。当你需要这些具体内容来回答用户、或用来填好某个工具的创作参数，而 project_state_snapshot 和当前对话里都没有时才调用。当前阶段、进度、下一步、projectId、episodeId、审批状态都已经写在 project_state_snapshot 里，不要为了看这些而调用。',
    en: 'Read concrete project or episode content: the full Bible text, past generation results, failure reasons, running task details, and asset, storyboard, and panel fields. Call it when you need that content to answer the user or to fill another tool\'s creative input, and project_state_snapshot and the conversation do not already contain it. The current stage, progress, next step, projectId, episodeId, and approval state are already in project_state_snapshot — do not call it just to read those.',
  },
  get_project_snapshot: {
    zh: '读取整个项目的结构化投影，用来了解项目全貌。当 project_state_snapshot 和当前对话不足以回答用户的具体请求、或不足以填好某个工具的创作参数时才调用。当前阶段、进度、下一步、projectId、episodeId、审批状态都已经写在 project_state_snapshot 里，不要为了看这些而调用。只有确实需要面板字段、提示词、描述文本或媒体 URL 时，才传 detail=full。',
    en: 'Read a structured projection of the whole project to understand its overall state. Call it when project_state_snapshot and the conversation are not enough to answer the user\'s concrete request or to fill another tool\'s creative input. The current stage, progress, next step, projectId, episodeId, and approval state are already in project_state_snapshot — do not call it just to read those. Pass detail=full only when you actually need panel fields, prompts, descriptions, or media URLs.',
  },
  get_episode_overview: {
    zh: '读取当前剧集的轻量总览：Bible、章节列表和各章进度统计。当用户在问某个章节或整体规划的问题、需要这份总览来回答时调用。',
    en: 'Read a lightweight overview of the current episode: the Bible, the chapter list, and per-chapter progress counts. Call it when the user asks about a chapter or overall planning and you need this overview to answer.',
  },
  get_chapter_detail: {
    zh: '读取单个章节的轻量详情：核心剪辑计划状态、分镜状态、视频片段状态、资产需求和章节成片输出。当用户在讨论某一章的细节、或某一章需要修复时调用。',
    en: 'Read lightweight details for one chapter: core edit plan status, storyboard status, video group status, asset requirements, and chapter render output. Call it when the user discusses a specific chapter\'s details or a chapter needs to be repaired.',
  },
  asset_hub_list_folders: {
    zh: '列出当前用户的全局资产文件夹。',
    en: 'List the current user\'s global asset folders.',
  },
  asset_hub_picker: {
    zh: '列出可放进选择器的全局资产（角色和场景），并附带预览图链接。',
    en: 'List global assets (characters and locations) that can go into a picker, with preview image links.',
  },
  asset_hub_list_characters: {
    zh: '列出当前用户的全局角色，可用 folderId 只看某个文件夹。',
    en: 'List the current user\'s global characters, optionally narrowed to one folder with folderId.',
  },
  asset_hub_get_character: {
    zh: '按 id 读取单个全局角色的详情。',
    en: 'Read one global character\'s details by id.',
  },
  asset_hub_list_locations: {
    zh: '列出当前用户的全局场景，可用 folderId 只看某个文件夹。',
    en: 'List the current user\'s global locations, optionally narrowed to one folder with folderId.',
  },
  asset_hub_get_location: {
    zh: '按 id 读取单个全局场景的详情。',
    en: 'Read one global location\'s details by id.',
  },
  request_edit_bible_review_choice: {
    zh: '把生成好的剧集规划展示给用户审核：全局 Bible、剧情节拍、事件台账、情绪曲线和章节切分。用户可以确认锁定，也可以提交修改意见。它只用于剧集规划这一步的确认，不要拿它当“是否继续执行”的通用许可，也不要向用户描述它背后的卡片机制。',
    en: 'Show the finished episode plan to the user for review: the global Bible, beat sheet, event ledger, emotional curve, and chapter split. The user can confirm and lock it, or submit revision notes. Use it only to confirm the episode plan — do not use it as a generic "may I continue?" gate, and do not describe the underlying card mechanism to the user.',
  },
  request_edit_style_choice: {
    zh: '把生成好的视觉风格候选展示给用户，让用户选定其中一个作为整片风格。它只用于选风格这一步，不要拿它当通用的执行许可，也不要向用户描述背后的卡片机制。',
    en: 'Show the generated visual style candidates to the user and let them pick one as the film\'s style. Use it only to choose the style — do not use it as a generic execution gate, and do not describe the underlying card mechanism to the user.',
  },
  request_edit_asset_review_choice: {
    zh: '把生成好的资产和空间档案展示给用户，让用户审核并确认是否继续。它只用于资产审核这一步，不要拿它当通用的执行许可，也不要向用户描述背后的卡片机制。',
    en: 'Show the generated assets and spatial profiles to the user for review and a go/no-go decision. Use it only for asset review — do not use it as a generic execution gate, and do not describe the underlying card mechanism to the user.',
  },
  request_edit_budget_confirmation_choice: {
    zh: '在即将启动一批会消耗额度或产生计费的生产任务前，向用户确认预算并确认继续。它只用于计费/批量执行前的确认，不能用来替代 Bible、资产或风格的内容审核。',
    en: 'Before starting a batch of production tasks that will consume credits or incur billing, confirm the budget and the intent to continue with the user. Use it only as a pre-billing/pre-batch confirmation — it does not replace Bible, asset, or style content review.',
  },
  request_script_intake_choice: {
    zh: '当用户给的只是一句话创意、一个标题或一个主题方向，信息太少、还不足以稳定扩写成剧本时，用它发起一次扩写前创作问诊，让用户先补齐几个关键创作方向。如果用户给的已经是完整剧本、或已经足够具体可以直接扩写，就不要用它，直接用 ingest_script。',
    en: 'When the user gives only a one-line idea, a title, or a theme direction — too little to expand into a stable script — use this to run a pre-expansion creative intake so the user first fills in a few key creative directions. If the user already gave a complete script, or something specific enough to expand directly, do not use this — use ingest_script instead.',
  },
  ingest_script: {
    zh: '接收本集的剧本输入并提交扩写任务，生成全局 Bible、节拍表、台账、情绪曲线和章节切分。用户贴的是完整剧本时，sourceKind=paste；用户给的是已经足够具体的创作需求、标题、梗概，或问诊后整理出的 normalizedBrief 时，sourceKind=prompt_generated_outline。如果用户只给了太稀疏的一句话创意，先用 request_script_intake_choice 做问诊，不要直接扩写。',
    en: 'Take this episode\'s script input and submit the expansion task that generates the global Bible, beat sheet, ledger, emotional curve, and chapter split. When the user pasted a complete script, set sourceKind=paste; when the user gave a sufficiently specific creative request, title, or logline, or a post-intake normalizedBrief, set sourceKind=prompt_generated_outline. If the user only gave a too-sparse one-line idea, run request_script_intake_choice first instead of expanding directly.',
  },
  revise_bible: {
    zh: '根据用户的审核意见，修改当前的 Bible、节拍表、台账或情绪曲线。当用户对剧集规划提出了具体改动、需要覆盖现有全局规划时用它。',
    en: 'Apply the user\'s review notes to the current Bible, beat sheet, ledger, or emotional curve. Use it when the user has concrete changes to the episode plan that need to overwrite the existing global planning.',
  },
  generate_edit_style_previews: {
    zh: '生成视觉风格候选图，供用户挑选整片风格。用户要求重做、调整，或要更黑暗/更抽象/指定某种非真人画风时也用它；非真人画风可以是动漫 3D 或风格化 3D。重新生成会在已有候选后面追加新的候选。',
    en: 'Generate visual style preview images for the user to pick the film\'s style. Also use it when the user asks to redo or adjust the style, wants it darker or more abstract, or specifies a non-real-person art direction; a non-real-person direction can be anime 3D or stylized 3D. Regenerating appends new candidates after the existing ones.',
  },
  generate_edit_script_assets: {
    zh: '为当前剧本创建或复用所需的角色与场景资产，并为还缺图片的资产提交生成任务。需要处理哪些资产由系统自动确定，你不用先去查、也不用自己指定。',
    en: 'Create or reuse the character and location assets the current script needs, and submit generation tasks for assets that still lack images. The system decides which assets to handle — you do not need to look them up first or specify them yourself.',
  },
  revise_edit_script_assets: {
    zh: '当资产审核没通过时，根据用户的修改意见返工当前所需的资产图片。要返工哪些资产由系统按当前审核范围确定。任务真正提交成功（工具返回）之前，不要对用户说已经重新提交。',
    en: 'When asset review did not pass, rework the current required asset images according to the user\'s notes. The system decides which assets to rework based on the current review scope. Do not tell the user the tasks were resubmitted until this tool actually returns successfully.',
  },
  generate_edit_shot_execution_plan: {
    zh: '生成镜头执行计划，它统一包含镜头语言、空间 blocking、轴线、光线，以及人物和物体的位置。',
    en: 'Generate the shot execution plan, which covers cinematography, spatial blocking, the axis, lighting, and character and object positions in one place.',
  },
  generate_edit_script_storyboard: {
    zh: '根据核心剪辑计划和镜头执行计划，生成正式的分镜面板。',
    en: 'Generate the formal storyboard panels from the core edit plan and the shot execution plan.',
  },
  generate_edit_script_storyboard_images: {
    zh: '为已经生成、但还缺图片的分镜面板批量生成分镜图片。它只生成分镜图片，不要用 generate_episode_videos 来代替。',
    en: 'Batch-generate storyboard images for storyboard panels that already exist but still have no image. It only produces storyboard images — do not use generate_episode_videos in its place.',
  },
  generate_episode_videos: {
    zh: '为当前还缺视频的连续片段提交视频生成任务。需要生成哪些片段，由系统根据当前剧本、分镜图片和已有视频状态自动决定，你只需发起调用。',
    en: 'Submit video generation tasks for the continuous segments that still lack video. The system decides which segments to generate from the current script, storyboard images, and existing video state — you just make the call.',
  },
}

const GENERAL_PROJECT_AGENT_OPERATION_TITLE_COPY = {
  get_project_snapshot: {
    zh: '项目快照',
    en: 'Project snapshot',
  },
  get_project_context: {
    zh: '项目上下文',
    en: 'Project context',
  },
  get_task_status: {
    zh: '任务状态',
    en: 'Task status',
  },
  get_episode_overview: {
    zh: '剧集总览',
    en: 'Episode overview',
  },
  get_chapter_detail: {
    zh: '章节详情',
    en: 'Chapter detail',
  },
  request_edit_bible_review_choice: {
    zh: '确认剧集规划',
    en: 'Confirm episode plan',
  },
  request_edit_style_choice: {
    zh: '选择视觉风格',
    en: 'Choose visual style',
  },
  request_edit_asset_review_choice: {
    zh: '审核资产',
    en: 'Review assets',
  },
  request_edit_budget_confirmation_choice: {
    zh: '确认预算',
    en: 'Confirm budget',
  },
  request_script_intake_choice: {
    zh: '补充创作方向',
    en: 'Refine story brief',
  },
  confirm_bible: {
    zh: '确认剧集规划',
    en: 'Confirm episode plan',
  },
} satisfies Record<string, ProjectAgentOperationTitleCopy>

const EDIT_FIRST_OPERATION_TITLE_COPY = {
  ingest_script: {
    zh: '准备剧本蓝图',
    en: 'Prepare script plan',
  },
  revise_bible: {
    zh: '修改剧集规划',
    en: 'Revise episode plan',
  },
  generate_edit_style_previews: {
    zh: '生成视觉风格',
    en: 'Generate visual styles',
  },
  plan_chapters: {
    zh: '批量规划章节',
    en: 'Plan chapters',
  },
  generate_edit_script: {
    zh: '生成核心剪辑计划',
    en: 'Generate core edit plan',
  },
  replan_chapter: {
    zh: '重规划章节',
    en: 'Replan chapter',
  },
  generate_edit_script_assets: {
    zh: '生成所需资产',
    en: 'Generate required assets',
  },
  revise_edit_script_assets: {
    zh: '返工所需资产',
    en: 'Revise required assets',
  },
  generate_edit_shot_execution_plan: {
    zh: '生成镜头执行计划',
    en: 'Generate shot execution plan',
  },
  generate_edit_script_storyboard: {
    zh: '生成分镜面板',
    en: 'Generate storyboard panels',
  },
  generate_edit_script_storyboard_images: {
    zh: '生成分镜图片',
    en: 'Generate storyboard images',
  },
  generate_episode_bgm_score: {
    zh: '生成配乐规划',
    en: 'Generate music plan',
  },
  generate_episode_videos: {
    zh: '生成视频片段',
    en: 'Generate video clips',
  },
  render_chapters: {
    zh: '渲染章节成片',
    en: 'Render chapter videos',
  },
  render_final_video: {
    zh: '渲染最终视频',
    en: 'Render final video',
  },
} satisfies Record<EditFirstWorkflowOperationId, ProjectAgentOperationTitleCopy>

const PROJECT_AGENT_OPERATION_TITLE_COPY: Record<string, ProjectAgentOperationTitleCopy> = {
  ...GENERAL_PROJECT_AGENT_OPERATION_TITLE_COPY,
  ...EDIT_FIRST_OPERATION_TITLE_COPY,
}

export function localizeSelectableToolDescription(
  operationId: string,
  fallback: string,
  locale: ProjectAgentLocale,
): string {
  const copy = SELECTABLE_TOOL_DESCRIPTION_COPY[operationId]
  if (!copy) return fallback
  return copy[locale]
}

export function localizeProjectAgentOperationTitle(
  operationId: string,
  locale: ProjectAgentLocale,
): string {
  const copy = PROJECT_AGENT_OPERATION_TITLE_COPY[operationId]
  if (!copy) return locale === 'en' ? 'Project operation' : '项目操作'
  return copy[locale]
}

export function buildCompressionPrompt(locale: ProjectAgentLocale, transcript: string): {
  system: string
  prompt: string
} {
  if (locale === 'en') {
    return {
      system: [
        'Summarize an older assistant conversation for continued execution.',
        'Keep concrete facts only: user goals, confirmed decisions, pending approvals, created ids, errors, unfinished work, and constraints.',
        'Do not invent facts. Do not omit destructive or billable decisions.',
        'Return plain text with short bullet lines.',
      ].join('\n'),
      prompt: `Summarize the following earlier conversation for future turns:\n\n${transcript}`,
    }
  }

  return {
    system: [
      '请把较早的 assistant 对话压缩成后续可继续执行的摘要。',
      '只保留具体事实：用户目标、已确认决策、待审批事项、已创建的 id、错误、未完成工作、关键约束。',
      '禁止编造事实，禁止省略 destructive 或 billable 决策。',
      '返回纯文本，用简短项目符号。',
    ].join('\n'),
    prompt: `请总结下面这段较早的对话，供后续轮次继续使用：\n\n${transcript}`,
  }
}

export function buildSummaryText(locale: ProjectAgentLocale, summary: string): string {
  return locale === 'en'
    ? `Conversation summary for earlier turns:\n${summary.trim()}`
    : `早期对话摘要：\n${summary.trim()}`
}
