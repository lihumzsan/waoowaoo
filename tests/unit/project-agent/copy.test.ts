import { describe, expect, it } from 'vitest'
import {
  localizeProjectAgentOperationTitle,
  localizeSelectableToolDescription,
} from '@/lib/project-agent/copy'
import { buildProjectAgentSystemPrompt } from '@/lib/project-agent/system-prompt'
import { EDIT_FIRST_WORKFLOW_OPERATION_IDS } from '@/lib/project-workflow/edit-first-operation-policy'

describe('project agent prompt copy', () => {
  it('builds the Chinese project-agent system prompt with staged workflow guardrails', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantPermissionMode: 'ask',
    })

    expect(prompt).toContain('WaooWaoo 是面向 AI 短片与剪辑先行视频创作的项目工作台')
    expect(prompt).toContain('你的职责不是泛用聊天、自由写作，或绕过工作流直接生成最终内容')
    expect(prompt).toContain('你只能使用本轮提供的工具和上下文')
    expect(prompt).toContain('友好、清晰、克制')
    expect(prompt).toContain('默认不使用 emoji、颜文字、鼓励口号或夸张情绪词')
    expect(prompt).toContain('避免“哇”“太棒了”“Let\'s go”“冲呀”等情绪化话术')
    expect(prompt).toContain('工具调用说明')
    expect(prompt).toContain('每轮第一次工具调用前，必须先输出一句用户可见的自然语言说明')
    expect(prompt).toContain('不要暴露内部工具名、operation id、workflow gate、SDK 机制或审批 UI 机制')
    expect(prompt).toContain('不要告诉用户“我会弹出卡片/等待卡片/发送确认卡”')
    expect(prompt).toContain('行为原则')
    expect(prompt).toContain('状态优先：以 `[project_state_snapshot]` 和工具结果为事实来源')
    expect(prompt).toContain('阶段纪律：只推进最早可执行阶段')
    expect(prompt).toContain('合理质疑')
    expect(prompt).not.toContain('你的语气友好、活泼、轻松')
    expect(prompt).not.toContain('可以适当使用 emoji 和颜文字')
    expect(prompt).not.toContain('再加一点活泼的点缀')

    expect(prompt).toContain('[project_state_snapshot]')
    expect(prompt).toContain('唯一权威状态')
    expect(prompt).toContain('默认不要调用 get_project_context 或 get_project_snapshot')
    expect(prompt).toContain('不要为了“确认一下”“保险起见”“查看进度”“判断下一步”')
    expect(prompt).toContain('工具参数只允许携带用户本轮新表达的创作意图或修改意见')
    expect(prompt).toContain('不要由你提交')
    expect(prompt).toContain('只读后如果信息已足够，必须继续执行当前明确下一步')

    expect(prompt).toContain('每轮循环')
    expect(prompt).toContain('用户选择返回')
    expect(prompt).toContain('任务更新')
    expect(prompt).toContain('当前阶段有唯一明确下一步工具：先说一句，再同轮调用')
    expect(prompt).toContain('用户给出修改意见：立刻调用当前阶段修改/重生成工具')
    expect(prompt).toContain('工具返回 async=true 后，不要同轮轮询')
    expect(prompt).toContain('失败处理与重试边界')
    expect(prompt).toContain('临时外部服务错误、网络/超时、队列瞬时失败由任务队列自动重试')
    expect(prompt).toContain('不能原样重复同一请求')
    expect(prompt).not.toContain('最多自动重试 2 次')

    expect(prompt).toContain('剪辑先行工作流')
    expect(prompt).toContain('源剧本摄入 -> 剧集规划（全局 Bible、节拍、台账、情绪曲线、章节切分）-> 用户确认剧集规划')
    expect(prompt).toContain('核心剪辑计划 -> 角色/场景资产与空间档案')
    expect(prompt).toContain('这是依赖顺序，不是固定话术流程')
    expect(prompt).toContain('修复/重新生成用户正在反馈的当前阶段产物')
    expect(prompt).toContain('源文本规模由剧本摄入上限和章节切分控制')
    expect(prompt).toContain('不要选择或生成真人、实拍真人、写实真人')
    expect(prompt).toContain('真人 3D、写实真人 3D、CG 真人或 CGI 真人')
    expect(prompt).toContain('允许明确非真人的 3D/CG')
    expect(prompt).toContain('动漫 3D、风格化 3D')
    expect(prompt).toContain('永远不要替用户做内容选择')
    expect(prompt).toContain('工具失败时，不要在聊天里伪造剧本、核心剪辑表、资产、分镜、任务进度或替代结果')
    expect(prompt).toContain('时长、画面比例')
    expect(prompt).toContain('剧集规划确认')
    expect(prompt).toContain('视觉风格')
    expect(prompt).toContain('资产审核')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')

    expect(prompt).toContain('剧集规划生成或修改是异步任务')
    expect(prompt).toContain('从上下文读取当前完整全局 Bible、章节切分和关键规划摘要，并在对话中完整输出可确认内容')
    expect(prompt).toContain('只要输入过于稀疏，就必须先调用扩写前创作问诊选择工具')
    expect(prompt).toContain('立刻调用剧集规划修改工具；不要推迟到视觉风格阶段')
    expect(prompt).toContain('用户提交修改意见时，视为未通过审核')
    expect(prompt).toContain('主流程的资产生成/返工范围由系统根据当前核心剪辑计划和资产审核阶段解析')
    expect(prompt).toContain('不要为了查找或提交 requirementId 调用只读工具')
    expect(prompt).toContain('没有 ready 的镜头执行计划时，不要生成正式分镜')
    expect(prompt).not.toContain('只能通过固定 workflow package 执行')
    expect(prompt).not.toContain('workflow package 内部 skills 顺序不可更改')
    expect(prompt).not.toContain('先调用 search_skills')
    expect(prompt).not.toContain('Agent Skill')
    expect(prompt).not.toContain('skill catalog')
  })

  it('builds the English project-agent system prompt with matching workflow guardrails', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'en',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantPermissionMode: 'auto',
    })

    expect(prompt).toContain('WaooWaoo is a project workspace for AI short-film and edit-first video creation')
    expect(prompt).toContain('Your job is not general chat, free-form writing, or bypassing the workflow')
    expect(prompt).toContain('You may only use the tools and context provided this turn')
    expect(prompt).toContain('friendly, clear, and restrained')
    expect(prompt).toContain('No emoji, kaomoji, cheerleading, or exaggerated emotion by default')
    expect(prompt).toContain('Avoid hype like "Wow", "Great news", "Let\'s go"')
    expect(prompt).toContain('Announcing tool calls')
    expect(prompt).toContain('Before the first tool call of a turn, always output one visible, user-facing sentence')
    expect(prompt).toContain('Never expose internal tool names, operation ids, workflow gates, SDK mechanics, or approval-UI mechanics')
    expect(prompt).toContain('Never tell the user you will "pop up", "wait for", or "send" a card')
    expect(prompt).toContain('Operating principles')
    expect(prompt).toContain('State first: use `[project_state_snapshot]` and tool results as facts')
    expect(prompt).toContain('Stage discipline: advance only the earliest executable stage')
    expect(prompt).toContain('Reasonable challenge')
    expect(prompt).not.toContain('friendly, lively, and relaxed')
    expect(prompt).not.toContain('Use emoji and kaomoji in moderation')
    expect(prompt).not.toContain('add a light flourish')

    expect(prompt).toContain('[project_state_snapshot]')
    expect(prompt).toContain('single source of truth')
    expect(prompt).toContain('By default do NOT call get_project_context or get_project_snapshot')
    expect(prompt).toContain('Never read only to "double-check", "be safe", "look at progress", "decide the next step"')
    expect(prompt).toContain('Tool parameters may carry only creative intent or revision notes newly expressed by the user this turn')
    expect(prompt).toContain('Do not submit business parameters the system can derive from current context')
    expect(prompt).toContain('After a read-only call, if you now have enough, continue with the clear next step')

    expect(prompt).toContain('The turn loop')
    expect(prompt).toContain('User-choice return')
    expect(prompt).toContain('Task update')
    expect(prompt).toContain('The current stage has one clear next tool: announce one sentence, then call it in the same turn')
    expect(prompt).toContain('Revision feedback: call the current-stage revision/regeneration tool now')
    expect(prompt).toContain('After a tool returns async=true, do not poll in the same turn')
    expect(prompt).toContain('Failure handling and retry boundaries')
    expect(prompt).toContain('temporary queue failures are retried by the task queue')
    expect(prompt).toContain('never repeat the same request unchanged')
    expect(prompt).not.toContain('Retry automatically at most twice')

    expect(prompt).toContain('Edit-first workflow')
    expect(prompt).toContain('source script ingestion -> episode plan (global Bible, beat sheet, ledger, emotional curve, chapter split) -> user episode-plan confirmation')
    expect(prompt).toContain('chapter core edit plans -> character/location assets & spatial profiles')
    expect(prompt).toContain('This is a dependency order, not a fixed script')
    expect(prompt).toContain('repair/regenerate the current-stage artifact the user is responding to')
    expect(prompt).toContain('Source size is controlled by the script ingestion limit and chapter split')
    expect(prompt).toContain('never choose or generate real-person, live-action, photorealistic-human')
    expect(prompt).toContain('real-person 3D, photorealistic-human 3D')
    expect(prompt).toContain('Clearly non-real 3D/CG is allowed')
    expect(prompt).toContain('anime 3D, stylized 3D')
    expect(prompt).toContain('Never make a content choice for the user')
    expect(prompt).toContain('On tool failure, never fabricate bibles, core edit tables, assets, storyboards, task progress, or substitute results')
    expect(prompt).toContain('episode-plan confirmation outcome')
    expect(prompt).toContain('visual style')
    expect(prompt).toContain('asset-review outcome')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')

    expect(prompt).toContain('Episode-plan generation or revision is async')
    expect(prompt).toContain('choiceType=script_intake')
    expect(prompt).toContain('normalizedBrief')
    expect(prompt).toContain('if the input is too sparse, you must first call the pre-expansion creative intake choice tool')
    expect(prompt).toContain('read the current full global Bible, chapter split, and key planning summary from context and output the confirmable content completely in chat')
    expect(prompt).toContain('call the episode-plan revision tool now; do not defer to the visual style stage')
    expect(prompt).toContain('Current permission mode: auto')
    expect(prompt).toContain('Never skip the current stage to run a later one')
    expect(prompt).toContain('never batch-advance multiple future stages')
    expect(prompt).toContain('If the user submits revision notes, treat the review as not approved')
    expect(prompt).toContain('the main-flow asset generation/revision scope is resolved by the system')
    expect(prompt).toContain('Do not call read-only tools to look up or submit requirementId')
    expect(prompt).toContain('Do not generate formal storyboard panels without a ready shot execution plan')
  })

  it('describes script ingestion as source-text only', () => {
    const zhDescription = localizeSelectableToolDescription('ingest_script', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('ingest_script', 'fallback', 'en')

    expect(zhDescription).toContain('剧本输入')
    expect(zhDescription).toContain('sourceKind=paste')
    expect(zhDescription).toContain('sourceKind=prompt_generated_outline')
    expect(zhDescription).toContain('先用 request_script_intake_choice 做问诊')
    expect(zhDescription).not.toContain('跳过问诊')
    // Param-level rules (do not pass projectId/episodeId) now live in the tool input schema, not the description.
    expect(zhDescription).not.toContain('projectId')
    expect(enDescription).toContain('episode\'s script input')
    expect(enDescription).toContain('sourceKind=paste')
    expect(enDescription).toContain('sourceKind=prompt_generated_outline')
    expect(enDescription).toContain('run request_script_intake_choice first')
    expect(enDescription).not.toContain('skip intake')
    expect(enDescription).not.toContain('projectId')

    const zhIntakeDescription = localizeSelectableToolDescription('request_script_intake_choice', 'fallback', 'zh')
    const enIntakeDescription = localizeSelectableToolDescription('request_script_intake_choice', 'fallback', 'en')
    expect(zhIntakeDescription).toContain('扩写前创作问诊')
    expect(zhIntakeDescription).toContain('直接用 ingest_script')
    expect(enIntakeDescription).toContain('pre-expansion creative intake')
    expect(enIntakeDescription).toContain('use ingest_script instead')
  })

  it('describes project context reads as concrete-detail only', () => {
    const zhDescription = localizeSelectableToolDescription('get_project_context', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('get_project_context', 'fallback', 'en')

    expect(zhDescription).toContain('读取项目或剧集的具体内容')
    expect(zhDescription).toContain('完整 Bible 正文')
    expect(zhDescription).toContain('不要为了看这些而调用')
    expect(enDescription).toContain('Read concrete project or episode content')
    expect(enDescription).toContain('the full Bible text')
    expect(enDescription).toContain('do not call it just to read those')
  })

  it('describes project snapshot reads as detailed-projection only', () => {
    const zhDescription = localizeSelectableToolDescription('get_project_snapshot', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('get_project_snapshot', 'fallback', 'en')

    expect(zhDescription).toContain('读取整个项目的结构化投影')
    expect(zhDescription).toContain('不要为了看这些而调用')
    expect(zhDescription).toContain('才传 detail=full')
    expect(enDescription).toContain('Read a structured projection of the whole project')
    expect(enDescription).toContain('do not call it just to read those')
    expect(enDescription).toContain('Pass detail=full only when you actually need panel fields, prompts, descriptions, or media URLs')
  })

  it('localizes user-facing operation titles without exposing internal ids', () => {
    for (const operationId of EDIT_FIRST_WORKFLOW_OPERATION_IDS) {
      expect(localizeProjectAgentOperationTitle(operationId, 'zh')).not.toBe('项目操作')
      expect(localizeProjectAgentOperationTitle(operationId, 'en')).not.toBe('Project operation')
    }

    expect(localizeProjectAgentOperationTitle('ingest_script', 'zh')).toBe('准备剧本蓝图')
    expect(localizeProjectAgentOperationTitle('ingest_script', 'en')).toBe('Prepare script plan')
    expect(localizeProjectAgentOperationTitle('request_script_intake_choice', 'zh')).toBe('补充创作方向')
    expect(localizeProjectAgentOperationTitle('request_script_intake_choice', 'en')).toBe('Refine story brief')
    expect(localizeProjectAgentOperationTitle('generate_edit_shot_execution_plan', 'zh')).toBe('生成镜头执行计划')
    expect(localizeProjectAgentOperationTitle('generate_edit_shot_execution_plan', 'en')).toBe('Generate shot execution plan')
    expect(localizeProjectAgentOperationTitle('generate_edit_script_storyboard', 'zh')).toBe('生成分镜面板')
    expect(localizeProjectAgentOperationTitle('unknown_internal_tool', 'zh')).toBe('项目操作')
  })

  it('describes bible revision as a user-note-driven overwrite', () => {
    const zhDescription = localizeSelectableToolDescription('revise_bible', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('revise_bible', 'fallback', 'en')

    expect(zhDescription).toContain('修改当前的 Bible')
    expect(zhDescription).toContain('根据用户的审核意见')
    expect(zhDescription).not.toContain('projectId')
    expect(enDescription).toContain('current Bible')
    expect(enDescription).toContain('the user\'s review notes')
    expect(enDescription).not.toContain('projectId')
  })

  it('describes style preview generation as regeneratable with user direction only', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_style_previews', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_style_previews', 'fallback', 'en')

    expect(zhDescription).toContain('生成视觉风格候选图')
    expect(zhDescription).toContain('非真人画风可以是动漫 3D 或风格化 3D')
    expect(zhDescription).toContain('重新生成会在已有候选后面追加新的候选')
    expect(enDescription).toContain('Generate visual style preview images')
    expect(enDescription).toContain('non-real-person direction can be anime 3D or stylized 3D')
    expect(enDescription).toContain('Regenerating appends new candidates')
  })

  it('describes edit asset generation as system-resolved scope', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_script_assets', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_script_assets', 'fallback', 'en')

    expect(zhDescription).toContain('需要处理哪些资产由系统自动确定')
    expect(zhDescription).toContain('你不用先去查')
    expect(enDescription).toContain('The system decides which assets to handle')
    expect(enDescription).toContain('you do not need to look them up first')
  })

  it('describes edit asset revision as requiring user review notes', () => {
    const zhDescription = localizeSelectableToolDescription('revise_edit_script_assets', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('revise_edit_script_assets', 'fallback', 'en')

    expect(zhDescription).toContain('资产审核没通过')
    expect(zhDescription).toContain('根据用户的修改意见')
    expect(zhDescription).toContain('要返工哪些资产由系统按当前审核范围确定')
    expect(zhDescription).toContain('任务真正提交成功（工具返回）之前，不要对用户说已经重新提交')
    expect(enDescription).toContain('asset review did not pass')
    expect(enDescription).toContain('the user\'s notes')
    expect(enDescription).toContain('The system decides which assets to rework based on the current review scope')
    expect(enDescription).toContain('Do not tell the user the tasks were resubmitted until this tool actually returns successfully')
  })
})
