import type { ProjectAgentLocale } from './locale'
import type { EditFirstWorkflowOperationId } from '@/lib/project-workflow/edit-first-operation-policy'

type ProjectAgentOperationTitleCopy = {
  zh: string
  en: string
}

const SELECTABLE_TOOL_DESCRIPTION_COPY: Record<string, { zh: string; en: string }> = {
  get_project_context: {
    zh: '仅在本轮注入的 project_state_snapshot 与对话上下文不足以回答具体请求或补齐用户新表达的创作/修改意图时，读取具体项目/剧集内容，例如完整 Bible/章节切分、历史生成结果、失败详情、活动任务详情、资产/分镜/面板字段。禁止仅为了确认当前阶段、进度、下一步、projectId、episodeId、审批状态或系统可推导的工具参数调用。',
    en: 'Load concrete project/episode content only when the injected project_state_snapshot and conversation context are insufficient for a concrete request or user-intent tool input, such as the full Bible/chapter split, historical generation results, failure details, active task details, or asset/storyboard/panel fields. Do not call merely to confirm the current phase, progress, next step, projectId, episodeId, approval state, or system-derived tool parameters.',
  },
  get_project_snapshot: {
    zh: '仅在本轮注入的 project_state_snapshot 与对话上下文不足以回答具体请求或补齐用户新表达的创作/修改意图时，读取详细项目投影。禁止仅为了确认当前阶段、进度、下一步、projectId、episodeId、审批状态、普通状态或系统可推导的工具参数而调用。只有明确需要面板字段、提示词、描述或媒体 URL 时才使用 detail=full。',
    en: 'Read detailed project projection only when the injected project_state_snapshot and conversation context are insufficient for a concrete request or user-intent tool input. Do not call merely to confirm the current phase, progress, next step, projectId, episodeId, approval state, general status, or system-derived tool parameters. Use detail=full only when panel fields, prompts, descriptions, or media URLs are explicitly needed.',
  },
  get_episode_overview: {
    zh: '读取当前集的轻量总览，包括 Bible、章节列表和章节进度统计。仅在需要回答具体章节/全局规划问题时使用；不要为了确认当前阶段、下一步或系统可推导参数而调用。',
    en: 'Read the lightweight scoped episode overview, including Bible, chapter list, and chapter progress counts. Use only for concrete chapter/global planning questions; do not call merely to confirm current stage, next step, or system-derived parameters.',
  },
  get_chapter_detail: {
    zh: '读取单个章节的轻量详情，包括核心剪辑计划状态、分镜状态、视频片段状态、资产需求和章成片输出。只有用户明确讨论某章细节或需要修复该章时调用。',
    en: 'Read lightweight details for one chapter: core edit plan status, storyboard status, video group status, asset requirements, and chapter render output. Call only when the user explicitly discusses a chapter detail or that chapter must be repaired.',
  },
  asset_hub_list_folders: {
    zh: '列出当前用户的全局资产文件夹。',
    en: 'List global asset folders for the current user.',
  },
  asset_hub_picker: {
    zh: '列出可供选择器使用的全局资产（角色/场景），并返回预览链接。',
    en: 'List global assets for picker use (character/location) with preview URLs.',
  },
  asset_hub_list_characters: {
    zh: '列出当前用户的全局角色，可按 folderId 过滤。',
    en: 'List global characters for the current user, optionally filtered by folderId.',
  },
  asset_hub_get_character: {
    zh: '按 id 获取单个全局角色。',
    en: 'Get a single global character by id.',
  },
  asset_hub_list_locations: {
    zh: '列出当前用户的全局场景，可按 folderId 过滤。',
    en: 'List global locations for the current user, optionally filtered by folderId.',
  },
  asset_hub_get_location: {
    zh: '按 id 获取单个全局场景。',
    en: 'Get a global location by id.',
  },
  request_edit_bible_review_choice: {
    zh: '在长视频生成流程中，剧集规划生成后请求用户确认全局制作蓝图：包括全局 Bible、剧情节拍、事件台账、情绪曲线和章节切分。用户可以确认锁定，或提交修改意见。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request episode-plan confirmation after planning completes: the global Bible, beat sheet, event ledger, emotional curve, and chapter split. The user can approve locking the plan or submit revision notes. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  request_edit_style_choice: {
    zh: '在短片生成流程中，视觉风格候选 ready 后请求用户选择一个视觉风格。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request the user to choose one visual style after style preview candidates are ready for short-film production. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  request_edit_asset_review_choice: {
    zh: '在短片生成流程中，资产和空间档案 ready 后请求用户审核资产并确认是否继续。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request required asset review after assets and spatial profiles are ready for short-film production. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  request_edit_budget_confirmation_choice: {
    zh: '在当前长视频生产阶段即将启动批量或计费任务前，请求用户确认预算与继续执行意图。只在 workflow 暴露该工具时使用；不要用它替代 Bible/资产/风格审核。',
    en: 'Request explicit user budget and continuation confirmation before starting the current batch or billable long-form production stage. Use only when the workflow exposes this tool; do not use it as a substitute for Bible, asset, or style review.',
  },
  request_script_intake_choice: {
    zh: '当用户给的是过于稀疏的一句话创意、标题或主题方向，并且尚不足以稳定扩写剧本时，必须请求一次扩写前创作问诊。只传用户原始 seedText；不要传 projectId、episodeId 或系统可推导参数。',
    en: 'Request one pre-expansion creative intake choice when the user provides a sparse one-line idea, title, or theme direction that is not yet enough for stable script expansion. Pass only the original user seedText; do not pass projectId, episodeId, or system-derived parameters.',
  },
  ingest_script: {
    zh: '准备本集剧本输入，并提交异步任务生成全局 Bible、节拍表、台账、情绪曲线和章节切分。完整剧本传 sourceKind=paste；足够明确的创作需求、标题、梗概或问诊后 normalizedBrief 传 sourceKind=prompt_generated_outline。过于稀疏的创意必须先走扩写前创作问诊。只传 text 和 sourceKind，不要传 projectId、episodeId、画幅、时长档位或系统可推导参数。',
    en: 'Prepare this episode script input and submit the async task that generates the global Bible, beat sheet, ledger, emotional curve, and chapter split. Use sourceKind=paste for a complete script; use sourceKind=prompt_generated_outline for a sufficiently specific creative request, title, logline, or post-intake normalizedBrief. Sparse ideas must first use pre-expansion creative intake. Pass only text and sourceKind; do not pass projectId, episodeId, aspect ratio, duration tier, or system-derived parameters.',
  },
  revise_bible: {
    zh: '按用户审核意见修改当前结构化 Bible/节拍表/台账/情绪曲线。仅在 Bible 未锁定且确实需要覆盖全局规划时使用；不要传 projectId、episodeId 或系统可推导参数。',
    en: 'Apply user-reviewed changes to the current structured Bible, beat sheet, ledger, or emotional curve. Use only while the Bible is unlocked and global planning truly needs to be overwritten; do not pass projectId, episodeId, or system-derived parameters.',
  },
  generate_edit_style_previews: {
    zh: '用户确认剧集规划后，基于已确认的全局 Bible 和章节切分生成视觉风格候选图。风格选择阶段用户要求重做、调整、更黑暗/更抽象/指定非真人画风时也可调用；非真人画风可以包含动漫 3D 或风格化 3D；只有用户给出新方向时才用 styleDirection 传入，不要传系统可推导参数；重新生成会追加候选。',
    en: 'Generate visual style preview images after the user confirms the episode plan, using the confirmed global Bible and chapter split. Also use during visual style choice when the user asks to redo, adjust, make darker/more abstract, or specify a non-real-person art direction; non-real-person art direction may include anime 3D or stylized 3D. Pass styleDirection only when the user gives a new direction; do not pass system-derived parameters. Regeneration appends new candidates.',
  },
  generate_edit_script_assets: {
    zh: '根据当前核心剪辑计划创建/复用所需角色与场景资产，并为缺失图片提交生成任务。系统会从当前剪辑计划解析需要处理的需求；不要为了查找或提交 requirementId 调用只读工具。',
    en: 'Create or reuse required character/location assets from the current core edit plan and submit missing image tasks. The system resolves the required items from the current edit plan; do not call read-only tools to look up or submit requirementId.',
  },
  revise_edit_script_assets: {
    zh: '在资产审核未通过时，按用户提交的 revisionNotes 返工当前所需资产图片。只传用户修改意见；资产范围由系统根据当前审核阶段确定。工具成功返回前，不要声称已经重新提交任务。',
    en: 'Revise the current required asset images after asset review is not approved. Pass only the user revision notes; the system resolves the asset scope from the current review stage. Do not claim tasks were resubmitted until this tool succeeds.',
  },
  generate_edit_shot_execution_plan: {
    zh: '在核心剪辑计划、资产和场景空间档案 ready 后，生成镜头执行计划；它统一包含镜头语言、空间 blocking、轴线、光线、人物和物体位置。只有当前 workflow 暴露该工具时才调用。',
    en: 'After the core edit plan, assets, and location spatial profiles are ready, generate the shot execution plan. It contains cinematography, spatial blocking, axis, lighting, character positions, and object positions. Call it only when the current workflow exposes this tool.',
  },
  generate_edit_script_storyboard: {
    zh: '从已 ready 的核心剪辑计划和镜头执行计划生成正式分镜面板。只有镜头执行计划已 ready 且当前 workflow 暴露该工具时才调用。',
    en: 'Generate formal storyboard panels from the ready core edit plan and shot execution plan. Call it only after the shot execution plan is ready and the current workflow exposes this tool.',
  },
  generate_edit_script_storyboard_images: {
    zh: '为短片生成流程中已经生成分镜面板但缺少图片的分镜格批量生成分镜图片。只有分镜面板已存在且缺少图片时使用；不要用 generate_episode_videos 代替它。',
    en: 'Batch-generate storyboard panel images for short-film storyboard panels that already exist but have no image. Use only when storyboard panels exist and images are missing; do not substitute generate_episode_videos.',
  },
  generate_episode_videos: {
    zh: '为短片生成流程中当前缺失视频的连续生成片段提交视频任务。模型只发起该工具，不传 episodeId、分镜、时长、模型、limit 或 generationOptions；系统会从当前项目上下文、核心剪辑计划、分镜图片和已有视频状态决定需要生成哪些连续片段。',
    en: 'Submit video tasks for the current missing continuous generation segments in short-film production. The model only calls this tool and must not pass episodeId, panels, duration, model, limit, or generationOptions; the system resolves the required continuous segments from the current project context, core edit plan, storyboard images, and existing video state.',
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
