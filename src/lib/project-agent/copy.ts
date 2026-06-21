import type { ProjectAgentLocale } from './locale'

const SELECTABLE_TOOL_DESCRIPTION_COPY: Record<string, { zh: string; en: string }> = {
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
  request_edit_first_choice: {
    zh: '在剪辑先行流程中请求固定内容选择：生成剧本前一次性询问时长和画面比例，剧本生成后请求剧本审核，风格候选 ready 后询问视觉风格，资产和空间档案 ready 后请求资产审核。不要用它做执行权限确认，也不要向用户描述任何卡片弹出机制。',
    en: 'Request a fixed content choice in edit-first production: ask duration and aspect ratio together before screenplay generation, request screenplay review after screenplay generation, ask visual style after style previews are ready, or request asset review after required assets and spatial profiles are ready. Do not use it for execution permission, and do not describe any card-rendering mechanism to the user.',
  },
  generate_edit_screenplay: {
    zh: '生成剪辑先行剧本。必须传入 prompt、durationTier、aspectRatio 三个字段；durationTier 和 aspectRatio 必须来自 request_edit_first_choice 返回的用户选择结果，不能只依赖 prompt 自然语言。该操作会提交异步任务；任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText 并在对话中完整逐字输出给用户；不要只说已生成，也不要让用户去画布查看。',
    en: 'Generate the edit-first screenplay. You must pass prompt, durationTier, and aspectRatio. durationTier and aspectRatio must come from the user selection confirmed through request_edit_first_choice; do not rely on prompt text alone. This operation submits an async task; in the terminal follow-up after completion, read the complete screenplayText from project context and echo it to the user in chat; do not merely say it was generated or tell the user to view the canvas.',
  },
  revise_edit_screenplay: {
    zh: '修改当前剪辑先行剧本。仅在剧本已生成、用户尚未确认进入风格候选/导演拆镜/剪辑表前使用。用户要求调整剧情、题材、氛围、结构、角色、结尾或表达方向时调用；必须传入 revisionInstruction、durationTier、aspectRatio，修改后仍停留在剧本审核阶段。该操作会提交异步任务；任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText 并在对话中完整逐字输出修改后的剧本；不要只说已修改，也不要让用户去画布查看。',
    en: 'Revise the current edit-first screenplay. Use only after the screenplay exists and before the user approves progression to style previews, director decoupage, or the edit table. Call it when the user asks to change story, subject, mood, structure, characters, ending, or expression direction; pass revisionInstruction, durationTier, and aspectRatio. The result remains in screenplay review. This operation submits an async task; in the terminal follow-up after completion, read the complete screenplayText from project context and echo the revised screenplay to the user in chat; do not merely say it was revised or tell the user to view the canvas.',
  },
  generate_edit_style_previews: {
    zh: '用户审核确认剧本后，基于剧本生成或重新生成 1-3 个视觉风格候选图。风格选择阶段用户要求重做、调整、更黑暗/更抽象/指定非真人画风时也可调用；非真人画风可以包含动漫 3D 或风格化 3D；用 styleDirection 传入用户方向，count 上限为 3，重新生成会追加候选。',
    en: 'Generate or regenerate 1-3 screenplay-based visual style preview images after screenplay review. Also use during visual style choice when the user asks to redo, adjust, make darker/more abstract, or specify a non-real-person art direction; non-real-person art direction may include anime 3D or stylized 3D; pass user feedback in styleDirection, count is capped at 3, and regeneration appends new candidates.',
  },
  generate_edit_script_assets: {
    zh: '根据当前剪辑先行表创建/复用所需角色与场景资产，并为缺失图片提交生成任务。要处理全部需求时不要传 requirementId；只有处理单个需求时才传真实 editScript.requirements[].id，禁止传 "*" 或任何通配值。',
    en: 'Create or reuse required character/location assets from the current edit-first table and submit missing image tasks. To process every requirement, omit requirementId; pass requirementId only for one exact editScript.requirements[].id. Never pass "*" or any wildcard value.',
  },
  generate_edit_script_storyboard_spatial_blocking: {
    zh: '在摄影 shot plan ready 后、生成分镜面板前，生成分镜空间定位/空间一致性准备。只有当前 workflow 暴露该工具时才调用；不要跳过它直接生成分镜面板。',
    en: 'After the cinematography shot plan is ready and before storyboard panels, generate storyboard spatial blocking / space-consistency preparation. Call it only when the current workflow exposes this tool; do not skip it and generate panels directly.',
  },
  generate_edit_script_storyboard: {
    zh: '从已 ready 的空间定位/空间一致性准备生成正式分镜面板。只有空间定位已 ready 且当前 workflow 暴露该工具时才调用；如果空间定位未 ready，先调用 generate_edit_script_storyboard_spatial_blocking。',
    en: 'Generate formal storyboard panels from ready spatial blocking / space-consistency preparation. Call it only after spatial blocking is ready and the current workflow exposes this tool; if spatial blocking is not ready, call generate_edit_script_storyboard_spatial_blocking first.',
  },
  generate_edit_script_storyboard_images: {
    zh: '为剪辑先行流程中已经生成分镜面板但缺少图片的分镜格批量生成分镜图片。只有分镜面板已存在且缺少图片时使用；不要用 generate_episode_videos 代替它。',
    en: 'Batch-generate storyboard panel images for edit-first panels that already exist but have no image. Use only when storyboard panels exist and images are missing; do not substitute generate_episode_videos.',
  },
}

const PROJECT_AGENT_OPERATION_TITLE_COPY: Record<string, { zh: string; en: string }> = {
  request_edit_first_choice: {
    zh: '确认选择',
    en: 'Confirm choices',
  },
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
  generate_edit_director_decoupage: {
    zh: '生成导演拆镜',
    en: 'Generate director decoupage',
  },
  generate_edit_script: {
    zh: '生成剪辑表',
    en: 'Generate edit table',
  },
  generate_edit_script_assets: {
    zh: '生成剪辑资产',
    en: 'Generate edit assets',
  },
  generate_edit_script_storyboard_spatial_blocking: {
    zh: '生成空间定位',
    en: 'Generate spatial blocking',
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
