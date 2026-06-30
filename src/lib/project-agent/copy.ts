import type { ProjectAgentLocale } from './locale'
import type { EditFirstWorkflowOperationId } from '@/lib/project-workflow/edit-first-operation-policy'

type ProjectAgentOperationTitleCopy = {
  zh: string
  en: string
}

const SELECTABLE_TOOL_DESCRIPTION_COPY: Record<string, { zh: string; en: string }> = {
  get_project_context: {
    zh: '仅在本轮注入的 project_state_snapshot 不足以回答用户请求或补齐下一步工具入参时，读取具体项目/剧集内容，例如完整剧本、历史生成结果、活动任务详情、资产/分镜/面板字段。禁止仅为了确认当前阶段、下一步、projectId 或 episodeId 调用。',
    en: 'Load concrete project/episode content only when the injected project_state_snapshot is insufficient for the user request or the next tool input, such as full screenplay text, historical generation results, active task details, or asset/storyboard/panel fields. Do not call merely to confirm the current phase, next step, projectId, or episodeId.',
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
  request_edit_duration_aspect_ratio_choice: {
    zh: '在短片生成流程中，生成剧本前请求用户一次性选择短片时长和画面比例。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request the user to choose duration and aspect ratio together before screenplay generation for short-film production. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  request_edit_screenplay_review_choice: {
    zh: '在短片生成流程中，剧本生成后请求用户审核剧本：确认进入视觉风格，或提交修改意见。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request screenplay review after screenplay generation for short-film production: approve progression to visual style, or submit revision notes. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  request_edit_style_choice: {
    zh: '在短片生成流程中，视觉风格候选 ready 后请求用户选择一个视觉风格。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request the user to choose one visual style after style preview candidates are ready for short-film production. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  request_edit_asset_review_choice: {
    zh: '在短片生成流程中，资产和空间档案 ready 后请求用户审核资产并确认是否继续。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request required asset review after assets and spatial profiles are ready for short-film production. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  generate_edit_screenplay: {
    zh: '生成短片剧本。必须传入 prompt、durationTier、aspectRatio 三个字段；durationTier 和 aspectRatio 必须来自 request_edit_duration_aspect_ratio_choice 返回的用户选择结果，不能只依赖 prompt 自然语言。该操作会提交异步任务；任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText 并在对话中完整逐字输出给用户；不要只说已生成，也不要让用户去画布查看。',
    en: 'Generate the short-film screenplay. You must pass prompt, durationTier, and aspectRatio. durationTier and aspectRatio must come from the user selection confirmed through request_edit_duration_aspect_ratio_choice; do not rely on prompt text alone. This operation submits an async task; in the terminal follow-up after completion, read the complete screenplayText from project context and echo it to the user in chat; do not merely say it was generated or tell the user to view the canvas.',
  },
  revise_edit_screenplay: {
    zh: '修改当前短片剧本。仅在剧本已生成、用户尚未确认进入风格候选/核心剪辑计划前使用。用户要求调整剧情、题材、氛围、结构、角色、结尾或表达方向时调用；必须传入 revisionInstruction、durationTier、aspectRatio，修改后仍停留在剧本审核阶段。该操作会提交异步任务；任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText 并在对话中完整逐字输出修改后的剧本；不要只说已修改，也不要让用户去画布查看。',
    en: 'Revise the current short-film screenplay. Use only after the screenplay exists and before the user approves progression to style previews or the core edit plan. Call it when the user asks to change story, subject, mood, structure, characters, ending, or expression direction; pass revisionInstruction, durationTier, and aspectRatio. The result remains in screenplay review. This operation submits an async task; in the terminal follow-up after completion, read the complete screenplayText from project context and echo the revised screenplay to the user in chat; do not merely say it was revised or tell the user to view the canvas.',
  },
  generate_edit_style_previews: {
    zh: '用户审核确认剧本后，基于剧本生成或重新生成 1-3 个视觉风格候选图。风格选择阶段用户要求重做、调整、更黑暗/更抽象/指定非真人画风时也可调用；非真人画风可以包含动漫 3D 或风格化 3D；用 styleDirection 传入用户方向，count 上限为 3，重新生成会追加候选。',
    en: 'Generate or regenerate 1-3 screenplay-based visual style preview images after screenplay review. Also use during visual style choice when the user asks to redo, adjust, make darker/more abstract, or specify a non-real-person art direction; non-real-person art direction may include anime 3D or stylized 3D; pass user feedback in styleDirection, count is capped at 3, and regeneration appends new candidates.',
  },
  generate_edit_script_assets: {
    zh: '根据当前核心剪辑计划创建/复用所需角色与场景资产，并为缺失图片提交生成任务。要处理全部需求时不要传 requirementId；只有处理单个需求时才传真实 editScript.requirements[].id，禁止传 "*" 或任何通配值。',
    en: 'Create or reuse required character/location assets from the current core edit plan and submit missing image tasks. To process every requirement, omit requirementId; pass requirementId only for one exact editScript.requirements[].id. Never pass "*" or any wildcard value.',
  },
  revise_edit_script_assets: {
    zh: '在资产审核未通过时，按用户提交的 revisionNotes 返工所需资产图片。必须传入 revisionNotes；只有要处理单个需求时才传真实 editScript.requirements[].id。工具成功返回前，不要声称已经重新提交任务。',
    en: 'Revise required asset images after asset review is not approved. Pass revisionNotes. Pass requirementId only for one exact editScript.requirements[].id. Do not claim tasks were resubmitted until this tool succeeds.',
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
}

const GENERAL_PROJECT_AGENT_OPERATION_TITLE_COPY = {
  get_project_phase: {
    zh: '项目阶段',
    en: 'Project phase',
  },
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
  request_edit_duration_aspect_ratio_choice: {
    zh: '选择时长与画幅',
    en: 'Choose duration & aspect ratio',
  },
  request_edit_screenplay_review_choice: {
    zh: '审核剧本',
    en: 'Review screenplay',
  },
  request_edit_style_choice: {
    zh: '选择视觉风格',
    en: 'Choose visual style',
  },
  request_edit_asset_review_choice: {
    zh: '审核资产',
    en: 'Review assets',
  },
} satisfies Record<string, ProjectAgentOperationTitleCopy>

const EDIT_FIRST_OPERATION_TITLE_COPY = {
  generate_edit_screenplay: {
    zh: '生成剧本',
    en: 'Generate screenplay',
  },
  revise_edit_screenplay: {
    zh: '修改剧本',
    en: 'Revise screenplay',
  },
  generate_edit_style_previews: {
    zh: '生成视觉风格',
    en: 'Generate visual styles',
  },
  generate_edit_script: {
    zh: '生成核心剪辑计划',
    en: 'Generate core edit plan',
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
  generate_episode_videos: {
    zh: '生成视频片段',
    en: 'Generate video clips',
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
