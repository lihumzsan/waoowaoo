import type { ProjectAgentLocale } from './locale'

type ProjectAgentOperationTitleCopy = {
  zh: string
  en: string
}

const SELECTABLE_TOOL_DESCRIPTION_COPY: Record<string, ProjectAgentOperationTitleCopy> = {
  request_choice: {
    zh: '只为当前一个决定发起通用 Choice。由你填写卡片标题、说明、选项、展示方式、按钮和可选回复；没有领域 choiceType，不保存后续步骤。需要立即采用当前结果时，只能冻结 registry 明确允许的一个当前 Operation 完整输入。',
    en: 'Ask one generic Choice for the current decision only. Author the title, description, options, presentation, buttons, and optional reply. There is no domain choiceType or stored follow-up. To adopt the current result immediately, freeze only one complete input for an Operation explicitly allowed by the registry.',
  },
  delegate_creative_work: {
    zh: '把一个或多个专业创作请求委派成独立 Creative Task。每个请求必须携带完整目标、精确来源 revision 和真实约束；Worker 自主读取相关 Skill，但不能调用业务 Operation、收费或改变项目状态。服务端不自动分 Chapter 或 Worker 组。',
    en: 'Delegate one or more professional creative requests as independent Creative Tasks. Each request carries a complete goal, exact source revisions, and real constraints. The Worker reads relevant Skills autonomously but cannot call business Operations, bill, or change project state. The server never creates Chapter or Worker groups automatically.',
  },
  adopt_style_bible: {
    zh: '把一个精确的 project.style_bible Resource revision 绑定为当前 Style Bible。必须传真实 revisionId 和替换时的 binding version；服务端回库校验内容，不复制、不生成预览，也不启动任何后续任务。',
    en: 'Bind one exact project.style_bible Resource revision as the current Style Bible. Pass the real revisionId and current binding version when replacing; the server reloads the revision, copies no content, generates no preview, and starts no downstream work.',
  },
  adopt_asset_manifest: {
    zh: '采用一个精确的 project.asset_manifest revision，并为其中每个 canonical entity 创建或复用项目资产 identity。只传 revisionId 和替换时的 binding version；不生成图片，也不启动后续任务。',
    en: 'Adopt one exact project.asset_manifest revision and create or reuse one Project asset identity for every canonical entity. Pass only the revisionId and current binding version when replacing; this generates no images and starts no downstream work.',
  },
  update_plan: {
    zh: '为复杂工作维护简短计划；它只是工作记忆，不执行工作、不创建 Task，也不控制工具。',
    en: 'Maintain a concise plan for complex work. It is working memory only and never executes work, creates Tasks, or controls tools.',
  },
  get_project_context: {
    zh: '读取当前项目或剧集的领域事实、精简资源工作集和任务摘要；不要从聊天记录或画布外观猜测。',
    en: 'Read current project or episode domain facts, the compact Resource working set, and Task summaries. Never infer them from chat history or Canvas appearance.',
  },
  get_project_snapshot: {
    zh: '读取项目的结构化事实投影；只在当前问题确实需要项目全貌时调用。',
    en: 'Read the project factual projection. Call it only when the current question needs the broader project state.',
  },
  update_project_config: {
    zh: '写入用户当前明确要求的项目配置。不得把 Agent 推荐当作用户确认，也不得猜模型或 Provider 参数。',
    en: 'Persist project configuration explicitly requested by the user now. Never treat an Agent recommendation as user confirmation or guess model/provider parameters.',
  },
  delete_asset: {
    zh: '按真实 identity 删除资产；遵守破坏性确认，仍被绑定或引用时明确失败。',
    en: 'Delete an asset by exact identity with destructive confirmation; fail explicitly while it remains bound or referenced.',
  },
  regenerate_asset: {
    zh: '在既有资产 identity 下重生成失败或不满意的图片，不创建替代 identity。',
    en: 'Regenerate failed or unsatisfactory images under the existing asset identity; never create a replacement identity.',
  },
  generate_voice: {
    zh: '用自然语言设计可复用音色并生成短试听；修改时在原 Resource 下新增 revision。',
    en: 'Design a reusable voice from natural language and render a short preview; revisions stay under the original Resource.',
  },
  bind_voice: {
    zh: '把精确音色 Resource revision 绑定、换绑或解绑到角色；不生成音频。',
    en: 'Bind, replace, or unbind an exact voice Resource revision for a character; this generates no audio.',
  },
}

const PROJECT_AGENT_OPERATION_TITLE_COPY: Record<string, ProjectAgentOperationTitleCopy> = {
  request_choice: { zh: '当前选择', en: 'Current choice' },
  delegate_creative_work: { zh: '专业创作', en: 'Creative work' },
  adopt_style_bible: { zh: '采用视觉 Style Bible', en: 'Adopt visual Style Bible' },
  adopt_asset_manifest: { zh: '采用资产清单', en: 'Adopt asset manifest' },
  update_plan: { zh: '更新计划', en: 'Update plan' },
  get_project_snapshot: { zh: '项目快照', en: 'Project snapshot' },
  get_project_context: { zh: '项目上下文', en: 'Project context' },
  create_text: { zh: '创建文字资源', en: 'Create text resource' },
  create_image: { zh: '生成图片资源', en: 'Generate image resource' },
  create_audio: { zh: '生成音频资源', en: 'Generate audio resource' },
  create_video: { zh: '生成视频资源', en: 'Generate video resource' },
  merge_videos: { zh: '合并视频资源', en: 'Merge video resources' },
  generate_voice: { zh: '设计角色音色', en: 'Design voice' },
  bind_voice: { zh: '绑定角色音色', en: 'Bind voice' },
  list_resources: { zh: '查看创作资源', en: 'List creative resources' },
  get_resource: { zh: '读取创作资源', en: 'Read creative resource' },
  adopt_resource: { zh: '采用创作资源', en: 'Adopt creative resource' },
  list_projects: { zh: '查看项目', en: 'List projects' },
  create_project: { zh: '创建项目', en: 'Create project' },
  get_project_basic: { zh: '读取项目基本信息', en: 'Read project basics' },
  update_project: { zh: '更新项目', en: 'Update project' },
  get_project_config: { zh: '读取项目配置', en: 'Read project configuration' },
  update_project_config: { zh: '设置项目配置', en: 'Set project configuration' },
  get_project_data: { zh: '读取项目数据', en: 'Read project data' },
  get_project_assets: { zh: '查看项目资产', en: 'List project assets' },
  get_project_video_urls: { zh: '查看项目视频', en: 'List project videos' },
  resolve_video_proxy: { zh: '解析视频地址', en: 'Resolve video address' },
  list_download_videos: { zh: '准备视频下载', en: 'Prepare video downloads' },
  list_tasks: { zh: '查看任务', en: 'List tasks' },
  get_task: { zh: '读取任务', en: 'Read task' },
  get_task_status: { zh: '任务状态', en: 'Task status' },
  get_user_preference: { zh: '读取用户偏好', en: 'Read user preference' },
  update_user_preference: { zh: '更新用户偏好', en: 'Update user preference' },
  list_user_models: { zh: '查看可用模型', en: 'List available models' },
  list_user_transactions: { zh: '查看交易记录', en: 'List transactions' },
  get_user_costs: { zh: '查看用户费用', en: 'Read user costs' },
  get_project_costs: { zh: '查看项目费用', en: 'Read project costs' },
  delete_asset: { zh: '删除资产', en: 'Delete asset' },
  regenerate_asset: { zh: '重新生成资产', en: 'Regenerate asset' },
  generate_character_image: { zh: '生成角色图片', en: 'Generate character image' },
  generate_location_image: { zh: '生成场景图片', en: 'Generate location image' },
  asset_hub_list_folders: { zh: '查看资产文件夹', en: 'List asset folders' },
  asset_hub_picker: { zh: '查看全局资产', en: 'Browse global assets' },
  asset_hub_list_characters: { zh: '查看全局角色', en: 'List global characters' },
  asset_hub_get_character: { zh: '读取全局角色', en: 'Read global character' },
  asset_hub_list_locations: { zh: '查看全局场景', en: 'List global locations' },
  asset_hub_get_location: { zh: '读取全局场景', en: 'Read global location' },
}

export function localizeSelectableToolDescription(
  operationId: string,
  fallback: string,
  locale: ProjectAgentLocale,
): string {
  return SELECTABLE_TOOL_DESCRIPTION_COPY[operationId]?.[locale] ?? fallback
}

export function localizeProjectAgentOperationTitle(
  operationId: string,
  locale: ProjectAgentLocale,
): string {
  return PROJECT_AGENT_OPERATION_TITLE_COPY[operationId]?.[locale]
    ?? (locale === 'en' ? 'Project operation' : '项目操作')
}

export function buildCompressionPrompt(locale: ProjectAgentLocale, transcript: string): {
  system: string
  prompt: string
} {
  if (locale === 'en') {
    return {
      system: [
        'Summarize an older assistant conversation for continued execution.',
        'Keep concrete facts only: user goals, decisions, pending interactions, exact ids, errors, unfinished work, and constraints.',
        'Do not invent facts. Return plain text with short bullet lines.',
      ].join('\n'),
      prompt: `Summarize the following earlier conversation for future turns:\n\n${transcript}`,
    }
  }
  return {
    system: [
      '请把较早的 assistant 对话压缩成后续可继续执行的摘要。',
      '只保留具体事实：用户目标、决定、待处理交互、精确 id、错误、未完成工作和约束。',
      '禁止编造事实，返回纯文本短项目符号。',
    ].join('\n'),
    prompt: `请总结下面这段较早的对话，供后续轮次继续使用：\n\n${transcript}`,
  }
}

export function buildSummaryText(locale: ProjectAgentLocale, summary: string): string {
  return locale === 'en'
    ? `Conversation summary for earlier turns:\n${summary.trim()}`
    : `早期对话摘要：\n${summary.trim()}`
}
