import type { ProjectAgentLocale } from './locale'
import type { EditFirstWorkflowOperationId } from '@/lib/project-workflow/edit-first-operation-ids'

type ProjectAgentOperationTitleCopy = {
  zh: string
  en: string
}

const SELECTABLE_TOOL_DESCRIPTION_COPY: Record<string, { zh: string; en: string }> = {
  delegate_creative_work: {
    zh: '把一次专业创作推理委派给无状态 Creative Worker。简单图片、视频、音乐或文字请求只需委派一次最小任务；长剧本可按计划分阶段委派。Worker 会自行发现并读取相关 Skill，但不能读取项目、调用业务 Operation、创建 Task、收费、持久化或改变状态；你必须传入全部真实上下文，并在返回后使用现有 Operation 执行实际动作。',
    en: 'Delegate one professional creative reasoning task to the stateless Creative Worker. A simple image, video, music, or text request needs one minimal delegation; a long script can be delegated in planned stages. The Worker discovers and reads relevant Skills by itself, but cannot read the project, call business Operations, create Tasks, charge, persist, or change state. Supply all real context, then use existing Operations for actual execution.',
  },
  update_plan: {
    zh: '为复杂或多阶段工作维护一份简短计划。每次调用完整替换当前计划，最多一个步骤处于 in_progress，进展变化后及时更新；传空 plan 可清除。它只是可见便签，不执行工作、不创建 Task，也不控制工具或项目状态。',
    en: 'Maintain a concise plan for complex or multi-step work. Each call replaces the whole current plan; keep at most one item in_progress, update it when progress changes, and pass an empty plan to clear it. This is a visible notebook only: it executes no work, creates no Tasks, and controls no tool or project state.',
  },
  get_project_context: {
    zh: '读取项目或剧集的具体内容，包括 Bible、专业产物、任务详情、资产和视频片段。需要真实内容来回答用户或规划新的自由创作时调用；不要从聊天记录或画布外观猜测。',
    en: 'Read concrete project or episode content, including the Bible, professional outputs, task details, assets, and video segments. Use it when real content is needed to answer or plan freeform creation; never infer those facts from chat history or Canvas appearance.',
  },
  get_project_snapshot: {
    zh: '读取整个项目的结构化投影，用来了解已有专业产物和项目全貌。只有确实需要视频片段状态或输出媒体 identity 时，才传 detail=full。',
    en: 'Read a structured projection of the whole project to understand its overall state. Call it when project_state_snapshot and the conversation are not enough to answer the user\'s concrete request or fill another tool\'s creative input. Pass detail=full only when video-segment state or output media identity is actually needed.',
  },
  get_episode_overview: {
    zh: '读取当前剧集的轻量总览：Bible、章节列表和各章进度统计。当用户在问某个章节或整体规划的问题、需要这份总览来回答时调用。',
    en: 'Read a lightweight overview of the current episode: the Bible, the chapter list, and per-chapter progress counts. Call it when the user asks about a chapter or overall planning and you need this overview to answer.',
  },
  get_chapter_detail: {
    zh: '读取单个章节的轻量详情：核心剪辑计划、镜头执行计划、视频片段状态、资产需求和章节成片输出。当用户在讨论某一章的细节、或某一章需要修复时调用。',
    en: 'Read lightweight details for one chapter: core edit plan, shot execution plan, video-segment status, asset requirements, and chapter render output. Call it when the user discusses a specific chapter or a chapter needs repair.',
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
    zh: '把生成好的制作规划展示给用户确认：全局 Bible、剧情节拍、事件台账、情绪曲线和章节切分。用户可以确认锁定，也可以提交修改意见。它只用于制作规划这一步的确认，不要拿它当“是否继续执行”的通用许可，也不要向用户描述它背后的卡片机制。',
    en: 'Show the finished production plan to the user for confirmation: global Bible, beat sheet, event ledger, emotional curve, and chapter split. The user can confirm and lock it, or submit revision notes. Use it only to confirm the production plan — do not use it as a generic "may I continue?" gate, and do not describe the underlying card mechanism to the user.',
  },
  request_edit_script_review_choice: {
    zh: '把生成后的完整剧本展示给用户确认。用户可以确认剧本进入制作规划，也可以提交剧本修改意见。它只用于 prompt 创作后的剧本确认，不能用来替代创作前问诊、制作规划确认或预算确认。',
    en: 'Show the generated full script to the user for confirmation. The user can approve it before production planning, or submit script revision notes. Use it only for post-creation script confirmation, not as a replacement for intake, production-plan confirmation, or budget confirmation.',
  },
  request_edit_style_choice: {
    zh: '把生成好的视觉风格候选展示给用户，让用户选定其中一个作为整片风格。它只用于选风格这一步，不要拿它当通用的执行许可，也不要向用户描述背后的卡片机制。',
    en: 'Show the generated visual style candidates to the user and let them pick one as the film\'s style. Use it only to choose the style — do not use it as a generic execution gate, and do not describe the underlying card mechanism to the user.',
  },
  request_edit_asset_review_choice: {
    zh: '把生成好的角色与场景资产展示给用户，让用户审核并确认是否继续。它只用于资产审核这一步，不要拿它当通用的执行许可，也不要向用户描述背后的卡片机制。',
    en: 'Show the generated character and location assets for review and a go/no-go decision. Use it only for asset review, not as a generic execution gate.',
  },
  request_script_intake_choice: {
    zh: '当用户明确选择专业剧本扩写路径，而输入又缺少时代背景、主角动机、核心冲突、关键关系、类型基调或结局走向等必要结构时，用它发起一次扩写前创作问诊。直接创建普通文字、图片、音频或视频不受此问诊约束；用户已经提供完整可拍剧本时也不需要问诊。',
    en: 'Use this for one pre-expansion intake when the user explicitly chooses the professional screenplay-expansion path and the brief lacks necessary structure such as setting, protagonist motivation, core conflict, key relationships, tone, or ending direction. Direct creation of ordinary text, images, audio, or video is not gated by this intake, and a complete filmable script does not need it.',
  },
  ingest_script: {
    zh: '接收本集的完整剧本，或专业剧本问诊后已经整理充分的创作简报。用户贴完整可拍剧本时，sourceKind=paste，任务会生成制作规划；问诊后的 normalizedBrief 使用 sourceKind=prompt_generated_outline，任务只扩写出完整剧本并等待用户确认。短创意只有在用户选择这条专业剧本扩写路径且简报不足时才需要先问诊；它不限制通用媒体创作。',
    en: 'Take this episode\'s complete script, or a sufficiently detailed brief from the professional screenplay intake. For a complete pasted script, use sourceKind=paste and the task generates the production plan. For the normalizedBrief returned by intake, use sourceKind=prompt_generated_outline; the task expands one full script and waits for user confirmation. A short idea needs intake only when the user chose this professional screenplay path and the brief is insufficient; it does not gate general media creation.',
  },
  approve_script: {
    zh: '确认剧本',
    en: 'Approve script',
  },
  revise_script: {
    zh: '根据用户在剧本确认卡片中的修改意见，基于当前生成出的完整剧本重新创作一版完整源剧本。只在 script_review 的用户选择返回 decision=revise 时调用。',
    en: 'Revise the current generated full source script using the user\'s notes from the script confirmation card. Call this only after a script_review choice result returns decision=revise.',
  },
  generate_bible_from_script: {
    zh: '在用户已经确认生成剧本后，从这份剧本生成制作规划、节拍表、事件台账、情绪曲线和章节切分。不要在 request_edit_script_review_choice 之前调用。',
    en: 'After the user has approved the generated script, generate the production plan, beat sheet, event ledger, emotional curve, and chapter split from that script. Do not call it before request_edit_script_review_choice.',
  },
  confirm_bible: {
    zh: '确认制作规划',
    en: 'Confirm production plan',
  },
  revise_bible: {
    zh: '根据用户在制作规划确认中的修改意见，修改当前的制作规划、节拍表、台账或情绪曲线。当用户对制作规划提出了具体改动、需要覆盖现有规划时用它。',
    en: 'Apply the user\'s review notes to the current Bible, beat sheet, ledger, or emotional curve. Use it when the user has concrete changes to the production plan that need to overwrite the existing global planning.',
  },
  generate_edit_style_previews: {
    zh: '生成视觉风格方案文案和候选图提示词。用户要求重做、调整，或指定更黑暗、更抽象、动漫 3D 或风格化 3D 方向时也用它。该操作是普通文本任务，不生成图片。',
    en: 'Generate the visual-style directions and image prompts. Also use it when the user asks to redo or adjust the style, wants it darker or more abstract, or specifies anime 3D or stylized 3D. This is a normal text task and does not generate images.',
  },
  generate_edit_style_preview_images: {
    zh: '为已生成的视觉风格方案构造精确图片报价，获得批准后生成候选图。不要用它修改风格文案。',
    en: 'Build the exact image quote for the generated visual-style directions and generate the preview images after approval. Do not use it to revise the style text.',
  },
  confirm_edit_style_preview: {
    zh: '确认用户刚刚在视觉风格选择卡片中选定的候选。stylePreviewId 必须原样使用 choice result 返回的值；本操作是写入选定风格的唯一入口。',
    en: 'Confirm the candidate the user just selected in the visual-style choice card. Use the exact stylePreviewId from the choice result; this operation is the only writer for the selected style.',
  },
  generate_edit_script_assets: {
    zh: '为当前剧本创建或复用所需的角色与场景资产，并为还缺图片的资产提交生成任务。需要处理哪些资产由系统自动确定，你不用先去查、也不用自己指定。',
    en: 'Create or reuse the character and location assets the current script needs, and submit generation tasks for assets that still lack images. The system decides which assets to handle — you do not need to look them up first or specify them yourself.',
  },
  approve_edit_script_assets: {
    zh: '确认所需资产',
    en: 'Approve required assets',
  },
  revise_edit_script_assets: {
    zh: '当资产审核没通过时，根据用户的修改意见返工当前所需的资产图片。要返工哪些资产由系统按当前审核范围确定。任务真正提交成功（工具返回）之前，不要对用户说已经重新提交。',
    en: 'When asset review did not pass, rework the current required asset images according to the user\'s notes. The system decides which assets to rework based on the current review scope. Do not tell the user the tasks were resubmitted until this tool actually returns successfully.',
  },
  generate_edit_shot_execution_plan: {
    zh: '生成镜头执行计划。它只为核心剪辑表中的每个镜头决定景别、运镜动作和运镜稳定性，不创建分镜图片或第二套剧情事实。',
    en: 'Generate the shot execution plan. It decides only shot scale, camera movement, and camera stability for each shot in the core edit table; it creates no intermediate images or second narrative source.',
  },
  generate_video_segments: {
    zh: '按核心剪辑表和镜头执行计划生成连续视频片段。系统自动冻结完整提示词与全能参考图，并始终启用模型原生音频。',
    en: 'Generate continuous video segments from the core edit table and shot execution plan. The system freezes the complete prompt and full-reference images and always enables native model audio.',
  },
  reference_to_character: {
    zh: '根据参考图片生成角色形象。该操作会先生成不可变图片任务与报价，只有用户批准后才提交。',
    en: 'Generate character images from references. This operation first creates an immutable media plan and quote, and submits it only after user approval.',
  },
  extract_reference_character_description: {
    zh: '只从参考图片提取角色文字描述，不生成图片，也不代表用户批准后续图片费用。',
    en: 'Extract only a text character description from reference images. It does not generate images or approve later media charges.',
  },
}

const GENERAL_PROJECT_AGENT_OPERATION_TITLE_COPY = {
  delegate_creative_work: {
    zh: '专业创作推理',
    en: 'Creative reasoning',
  },
  update_plan: {
    zh: '更新计划',
    en: 'Update plan',
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
  get_episode_overview: {
    zh: '剧集总览',
    en: 'Episode overview',
  },
  get_chapter_detail: {
    zh: '章节详情',
    en: 'Chapter detail',
  },
  reference_to_character: {
    zh: '参考图生成角色',
    en: 'Generate character from references',
  },
  extract_reference_character_description: {
    zh: '提取参考图角色描述',
    en: 'Extract reference character description',
  },
  request_edit_bible_review_choice: {
    zh: '确认制作规划',
    en: 'Confirm production plan',
  },
  request_edit_script_review_choice: {
    zh: '确认剧本',
    en: 'Confirm script',
  },
  request_edit_style_choice: {
    zh: '选择视觉风格',
    en: 'Choose visual style',
  },
  request_edit_asset_review_choice: {
    zh: '审核资产',
    en: 'Review assets',
  },
  request_script_intake_choice: {
    zh: '补充创作方向',
    en: 'Refine story brief',
  },
  confirm_bible: {
    zh: '确认制作规划',
    en: 'Confirm production plan',
  },
  create_text: {
    zh: '创建文字资源',
    en: 'Create text resource',
  },
  create_image: {
    zh: '生成图片资源',
    en: 'Generate image resource',
  },
  create_audio: {
    zh: '生成音频资源',
    en: 'Generate audio resource',
  },
  create_video: {
    zh: '生成视频资源',
    en: 'Generate video resource',
  },
  merge_videos: {
    zh: '合并视频资源',
    en: 'Merge video resources',
  },
  list_resources: {
    zh: '查看创作资源',
    en: 'List creative resources',
  },
  get_resource: {
    zh: '读取创作资源',
    en: 'Read creative resource',
  },
  adopt_resource: {
    zh: '采用创作资源',
    en: 'Adopt creative resource',
  },
  list_projects: { zh: '查看项目', en: 'List projects' },
  create_project: { zh: '创建项目', en: 'Create project' },
  list_tasks: { zh: '查看任务', en: 'List tasks' },
  dismiss_failed_tasks: { zh: '清除失败任务', en: 'Dismiss failed tasks' },
  get_task: { zh: '读取任务', en: 'Read task' },
  get_user_preference: { zh: '读取用户偏好', en: 'Read user preference' },
  update_user_preference: { zh: '更新用户偏好', en: 'Update user preference' },
  list_user_models: { zh: '查看可用模型', en: 'List available models' },
  list_user_transactions: { zh: '查看交易记录', en: 'List transactions' },
  get_user_costs: { zh: '查看用户费用', en: 'Read user costs' },
  get_user_api_config: { zh: '读取 API 配置', en: 'Read API configuration' },
  put_user_api_config: { zh: '更新 API 配置', en: 'Update API configuration' },
  get_task_batch: { zh: '读取任务批次', en: 'Read task batch' },
  get_project_basic: { zh: '读取项目基本信息', en: 'Read project basics' },
  update_project: { zh: '更新项目', en: 'Update project' },
  get_project_video_urls: { zh: '查看项目视频', en: 'List project videos' },
  resolve_video_proxy: { zh: '解析视频地址', en: 'Resolve video address' },
  list_download_videos: { zh: '准备视频下载', en: 'Prepare video downloads' },
  generate_project_music: { zh: '生成项目音乐', en: 'Generate project music' },
  get_edit_bible: { zh: '读取制作规划', en: 'Read production plan' },
  list_edit_chapters: { zh: '查看章节', en: 'List chapters' },
  list_recent_mutation_batches: { zh: '查看最近修改', en: 'List recent changes' },
  select_asset_render: { zh: '选择资产图片', en: 'Select asset image' },
  update_character_appearance_description: { zh: '更新角色外观描述', en: 'Update character appearance' },
  update_location_image_description: { zh: '更新场景图片描述', en: 'Update location image description' },
  get_project_config: { zh: '读取项目配置', en: 'Read project configuration' },
  update_project_config: { zh: '更新项目配置', en: 'Update project configuration' },
  get_project_assets: { zh: '查看项目资产', en: 'List project assets' },
  copy_asset_from_global: { zh: '复制全局资产', en: 'Copy global asset' },
  get_project_costs: { zh: '查看项目费用', en: 'Read project costs' },
  get_project_data: { zh: '读取项目数据', en: 'Read project data' },
  ai_create_character: { zh: '设计角色', en: 'Design character' },
  ai_create_location: { zh: '设计场景', en: 'Design location' },
  ai_modify_location: { zh: '修改场景', en: 'Modify location' },
  ai_modify_appearance: { zh: '修改角色外观', en: 'Modify character appearance' },
  ai_modify_prop: { zh: '修改道具', en: 'Modify prop' },
  regenerate_group: { zh: '重新生成资产组', en: 'Regenerate asset group' },
  regenerate_single_image: { zh: '重新生成图片', en: 'Regenerate image' },
  generate_character_image: { zh: '生成角色图片', en: 'Generate character image' },
  generate_location_image: { zh: '生成场景图片', en: 'Generate location image' },
} satisfies Record<string, ProjectAgentOperationTitleCopy>

const EDIT_FIRST_OPERATION_TITLE_COPY = {
  ingest_script: {
    zh: '创作剧本',
    en: 'Create script',
  },
  approve_script: {
    zh: '确认剧本',
    en: 'Approve script',
  },
  revise_script: {
    zh: '修改剧本',
    en: 'Revise script',
  },
  generate_bible_from_script: {
    zh: '生成制作规划',
    en: 'Generate production plan',
  },
  confirm_bible: {
    zh: '确认制作规划',
    en: 'Confirm production plan',
  },
  revise_bible: {
    zh: '修改制作规划',
    en: 'Revise production plan',
  },
  generate_edit_style_previews: {
    zh: '生成视觉风格方案',
    en: 'Generate visual style directions',
  },
  generate_edit_style_preview_images: {
    zh: '生成视觉风格候选图',
    en: 'Generate visual style preview images',
  },
  confirm_edit_style_preview: {
    zh: '确认视觉风格',
    en: 'Confirm visual style',
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
  approve_edit_script_assets: {
    zh: '确认所需资产',
    en: 'Approve required assets',
  },
  revise_edit_script_assets: {
    zh: '返工所需资产',
    en: 'Revise required assets',
  },
  generate_edit_shot_execution_plan: {
    zh: '生成镜头执行计划',
    en: 'Generate shot execution plan',
  },
  plan_episode_bgm_design: {
    zh: '规划配乐设计',
    en: 'Plan BGM design',
  },
  generate_episode_bgm_score: {
    zh: '生成配乐',
    en: 'Generate music score',
  },
  generate_video_segments: {
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
