import { describe, expect, it } from 'vitest'
import {
  localizeProjectAgentOperationTitle,
  localizeSelectableToolDescription,
} from '@/lib/project-agent/copy'
import { buildProjectAgentSystemPrompt } from '@/lib/project-agent/system-prompt'
import { EDIT_FIRST_WORKFLOW_OPERATION_IDS } from '@/lib/project-workflow/edit-first-operation-policy'

describe('project agent prompt copy', () => {
  it('uses direct operation rules instead of fixed workflow or skill-gateway rules', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantPermissionMode: 'ask',
    })

    expect(prompt).toContain('你只能使用当前轮提供的工具和项目上下文')
    expect(prompt).toContain('你的语气友好、清晰、克制')
    expect(prompt).toContain('默认不使用 emoji、颜文字、感叹式口号或夸张情绪词')
    expect(prompt).toContain('不要过度庆祝、鼓励、催促或拟人化表达')
    expect(prompt).toContain('避免“哇”“太棒了”“Let\'s go”“冲呀”等情绪化话术')
    expect(prompt).not.toContain('你的语气友好、活泼、轻松')
    expect(prompt).not.toContain('可以适当使用 emoji 和颜文字')
    expect(prompt).not.toContain('再加一点活泼的点缀')
    expect(prompt).toContain('读取本轮注入的项目状态')
    expect(prompt).toContain('[project_state_snapshot]')
    expect(prompt).toContain('本轮模型输入已经包含对话上下文和 [project_state_snapshot]')
    expect(prompt).toContain('默认不要调用 get_project_context 或 get_project_snapshot')
    expect(prompt).toContain('禁止因为“确认一下”“保险起见”“查看当前进度”“判断下一步”')
    expect(prompt).toContain('默认禁止调用 get_project_context 或 get_project_snapshot')
    expect(prompt).toContain('只有当用户请求或下一步工具入参明确缺少快照与对话上下文之外的具体字段时')
    expect(prompt).toContain('时长与画面比例选择')
    expect(prompt).toContain('用户审核剧本')
    expect(prompt).toContain('视觉风格候选图')
    expect(prompt).toContain('镜头执行计划')
    expect(prompt).toContain('这是依赖顺序，不是固定话术流程')
    expect(prompt).toContain('修复/重新生成用户正在反馈的当前阶段产物')
    expect(prompt).toContain('时长上限：剪辑先行剧本和剪辑表的目标总时长最多 120 秒')
    expect(prompt).toContain('不要选择或生成真人、实拍真人、写实真人')
    expect(prompt).toContain('真人 3D、写实真人 3D、CG 真人或 CGI 真人')
    expect(prompt).toContain('允许明确非真人的 3D/CG')
    expect(prompt).toContain('动漫 3D、风格化 3D')
    expect(prompt).toContain('不要把内部工具名、operation id、workflow gate、SDK 机制、审批 UI 机制暴露给用户')
    expect(prompt).toContain('本轮只要要调用任何工具，第一次工具调用前必须先输出一句用户可见的自然语言说明')
    expect(prompt).toContain('不要以工具调用作为本轮第一输出')
    expect(prompt).toContain('这条规则适用于所有工具：只读查询、内容选择、生成、修改、任务跟进和项目操作')
    expect(prompt).toContain('调用任何工具前，先给用户一句简短可见说明')
    expect(prompt).toContain('即使只是读取上下文或检查任务状态，也不能静默调用工具')
    expect(prompt).toContain('不要为了确认当前阶段、下一步、projectId 或 episodeId 调用只读查询')
    expect(prompt).toContain('用户询问具体的历史生成结果、任务结果、失败详情或正在运行的任务明细时，才调用 get_project_context')
    expect(prompt).toContain('不要告诉用户“我会弹出卡片/等待卡片/发送确认卡”')
    expect(prompt).toContain('工具失败时，不要在聊天里伪造剧本、剪辑表、资产、分镜、任务进度或替代结果')
    expect(prompt).toContain('时长和画面比例')
    expect(prompt).toContain('剧本审核')
    expect(prompt).toContain('视觉风格')
    expect(prompt).toContain('资产审核')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')
    expect(prompt).toContain('如果用户不满意或要求调整')
    expect(prompt).toContain('传入用户方向')
    expect(prompt).toContain('异步任务返回 async=true 后，不要同轮轮询')
    expect(prompt).toContain('当本轮输入包含 [task_update] 时，把它视为后台异步任务已经进入终态')
    expect(prompt).toContain('如果当前状态存在唯一明确的下一步工具')
    expect(prompt).toContain('然后在同一轮调用该工具；不要只总结任务成功后停止')
    expect(prompt).toContain('从项目上下文读取当前完整剧本')
    expect(prompt).toContain('逐字、完整地输出剧本全文')
    expect(prompt).toContain('调用剧本修改工具，不要把这些修改推迟到视觉风格阶段')
    expect(prompt).toContain('如果用户提交资产修改意见，把它当作未通过审核')
    expect(prompt).toContain('批量处理全部需求时不要传 requirementId')
    expect(prompt).toContain('禁止传 "*" 或任何通配值')
    expect(prompt).toContain('没有 ready 的镜头执行计划时，不要生成正式分镜')
    expect(prompt).not.toContain('只能通过固定 workflow package 执行')
    expect(prompt).not.toContain('workflow package 内部 skills 顺序不可更改')
    expect(prompt).not.toContain('先调用 search_skills')
    expect(prompt).not.toContain('Agent Skill')
    expect(prompt).not.toContain('skill catalog')
  })

  it('adds the same next-step gate to the English prompt', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'en',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantPermissionMode: 'auto',
    })

    expect(prompt).toContain('You may only use the tools and project context provided this turn')
    expect(prompt).toContain('Your tone is friendly, clear, and restrained')
    expect(prompt).toContain('Do not use emoji, kaomoji, cheerleading slogans, or exaggerated emotional wording by default')
    expect(prompt).toContain('Do not over-celebrate, over-encourage, rush the user, or anthropomorphize the process')
    expect(prompt).toContain('avoid phrases like "Wow", "Great news", "Let\'s go"')
    expect(prompt).not.toContain('friendly, lively, and relaxed')
    expect(prompt).not.toContain('Use emoji and kaomoji in moderation')
    expect(prompt).not.toContain('add a light flourish')
    expect(prompt).toContain('Read the project state injected for this turn')
    expect(prompt).toContain('[project_state_snapshot]')
    expect(prompt).toContain('This turn already includes conversation context and [project_state_snapshot]')
    expect(prompt).toContain('By default, do not call get_project_context or get_project_snapshot')
    expect(prompt).toContain('Do not call read-only tools because you want to "double-check", "be safe", "look at current progress", "decide the next step"')
    expect(prompt).toContain('By default, do not call get_project_context or get_project_snapshot')
    expect(prompt).toContain('clearly lacks concrete fields beyond the snapshot and conversation context')
    expect(prompt).toContain('duration and aspect-ratio choice')
    expect(prompt).toContain('user screenplay review')
    expect(prompt).toContain('visual style preview images')
    expect(prompt).toContain('shot execution plan')
    expect(prompt).toContain('This is a dependency order, not a fixed script')
    expect(prompt).toContain('repair/regenerate the current-stage artifact the user is responding to')
    expect(prompt).toContain('Duration cap: the edit-first screenplay and edit table target at most 120 seconds total')
    expect(prompt).toContain('do not choose or generate real-person, live-action, photorealistic-human')
    expect(prompt).toContain('real-person 3D, photorealistic-human 3D')
    expect(prompt).toContain('Clearly non-real-person 3D/CG is allowed')
    expect(prompt).toContain('anime 3D, stylized 3D')
    expect(prompt).toContain('Do not expose internal tool names, operation ids, workflow gates, SDK mechanics, or approval-UI mechanics')
    expect(prompt).toContain('If you will call any tool in this turn, first output one visible natural-language sentence to the user before the first tool call')
    expect(prompt).toContain('Do not start a turn with a tool call')
    expect(prompt).toContain('This rule applies to every tool: read-only queries, content choices, generation, revision, task follow-ups, and project operations')
    expect(prompt).toContain('Before calling any tool, give the user one short visible sentence')
    expect(prompt).toContain('even read-only context checks or task-status checks must not be silent')
    expect(prompt).toContain('Do not call read-only tools just to confirm the current phase, next step, projectId, or episodeId')
    expect(prompt).toContain('Only when the user asks for a concrete historical generation result, task result, failure detail, or currently running task detail, call get_project_context')
    expect(prompt).toContain('Do not tell the user "I will pop up a card / wait for a card / send a confirmation card."')
    expect(prompt).toContain('On tool failure, do not fabricate screenplays, edit tables, assets, storyboards, task progress, or substitute results')
    expect(prompt).toContain('duration and aspect ratio')
    expect(prompt).toContain('screenplay review')
    expect(prompt).toContain('visual style')
    expect(prompt).toContain('asset review')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')
    expect(prompt).toContain('If the user is unsatisfied or asks to adjust')
    expect(prompt).toContain("with the user's direction")
    expect(prompt).toContain('After an async task returns async=true, do not poll in the same turn')
    expect(prompt).toContain('When this turn includes [task_update], treat it as a background async task reaching a terminal state')
    expect(prompt).toContain('If the current state has one clear next tool')
    expect(prompt).toContain('then call that tool in the same turn; do not stop after only summarizing the successful task')
    expect(prompt).toContain('Read the current full screenplay from project context')
    expect(prompt).toContain('full screenplay verbatim')
    expect(prompt).toContain('call the screenplay revision tool; do not defer those changes to the visual style stage')
    expect(prompt).toContain('Current permission mode: auto')
    expect(prompt).toContain('Do not skip the current stage to run a later one')
    expect(prompt).toContain('Do not batch-advance multiple future stages')
    expect(prompt).toContain('If the user submits asset revision notes, treat the review as not approved')
    expect(prompt).toContain('omit requirementId to process all requirements')
    expect(prompt).toContain('never pass "*" or any wildcard value')
    expect(prompt).toContain('Do not generate formal storyboard panels without a ready shot execution plan')
  })

  it('describes screenplay generation as requiring structured duration and aspect ratio fields', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_screenplay', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_screenplay', 'fallback', 'en')

    expect(zhDescription).toContain('必须传入 prompt、durationTier、aspectRatio 三个字段')
    expect(zhDescription).toContain('必须来自 request_edit_duration_aspect_ratio_choice 返回的用户选择结果')
    expect(zhDescription).toContain('该操作会提交异步任务')
    expect(zhDescription).toContain('任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText')
    expect(zhDescription).toContain('完整逐字输出给用户')
    expect(enDescription).toContain('You must pass prompt, durationTier, and aspectRatio')
    expect(enDescription).toContain('confirmed through request_edit_duration_aspect_ratio_choice')
    expect(enDescription).toContain('This operation submits an async task')
    expect(enDescription).toContain('in the terminal follow-up after completion, read the complete screenplayText from project context')
    expect(enDescription).toContain('echo it to the user in chat')
  })

  it('describes project context reads as concrete-detail only', () => {
    const zhDescription = localizeSelectableToolDescription('get_project_context', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('get_project_context', 'fallback', 'en')

    expect(zhDescription).toContain('仅在本轮注入的 project_state_snapshot 与对话上下文不足以回答具体请求或补齐下一步工具入参时')
    expect(zhDescription).toContain('完整剧本、历史生成结果、失败详情、活动任务详情、资产/分镜/面板字段')
    expect(zhDescription).toContain('禁止仅为了确认当前阶段、进度、下一步、projectId、episodeId 或审批状态调用')
    expect(enDescription).toContain('only when the injected project_state_snapshot and conversation context are insufficient')
    expect(enDescription).toContain('full screenplay text, historical generation results, failure details, active task details, or asset/storyboard/panel fields')
    expect(enDescription).toContain('Do not call merely to confirm the current phase, progress, next step, projectId, episodeId, or approval state')
  })

  it('describes project snapshot reads as detailed-projection only', () => {
    const zhDescription = localizeSelectableToolDescription('get_project_snapshot', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('get_project_snapshot', 'fallback', 'en')

    expect(zhDescription).toContain('仅在本轮注入的 project_state_snapshot 与对话上下文不足以回答具体请求或补齐下一步工具入参时')
    expect(zhDescription).toContain('禁止仅为了确认当前阶段、进度、下一步、projectId、episodeId、审批状态或普通状态而调用')
    expect(zhDescription).toContain('只有明确需要面板字段、提示词、描述或媒体 URL 时才使用 detail=full')
    expect(enDescription).toContain('only when the injected project_state_snapshot and conversation context are insufficient')
    expect(enDescription).toContain('Do not call merely to confirm the current phase, progress, next step, projectId, episodeId, approval state, or general status')
    expect(enDescription).toContain('Use detail=full only when panel fields, prompts, descriptions, or media URLs are explicitly needed')
  })

  it('localizes user-facing operation titles without exposing internal ids', () => {
    for (const operationId of EDIT_FIRST_WORKFLOW_OPERATION_IDS) {
      expect(localizeProjectAgentOperationTitle(operationId, 'zh')).not.toBe('项目操作')
      expect(localizeProjectAgentOperationTitle(operationId, 'en')).not.toBe('Project operation')
    }

    expect(localizeProjectAgentOperationTitle('generate_edit_screenplay', 'zh')).toBe('生成剧本')
    expect(localizeProjectAgentOperationTitle('generate_edit_screenplay', 'en')).toBe('Generate screenplay')
    expect(localizeProjectAgentOperationTitle('generate_edit_shot_execution_plan', 'zh')).toBe('生成镜头执行计划')
    expect(localizeProjectAgentOperationTitle('generate_edit_shot_execution_plan', 'en')).toBe('Generate shot execution plan')
    expect(localizeProjectAgentOperationTitle('generate_edit_script_storyboard', 'zh')).toBe('生成分镜面板')
    expect(localizeProjectAgentOperationTitle('unknown_internal_tool', 'zh')).toBe('项目操作')
  })

  it('describes screenplay revision as review-stage only with structured fields', () => {
    const zhDescription = localizeSelectableToolDescription('revise_edit_screenplay', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('revise_edit_screenplay', 'fallback', 'en')

    expect(zhDescription).toContain('仅在剧本已生成')
    expect(zhDescription).toContain('必须传入 revisionInstruction、durationTier、aspectRatio')
    expect(zhDescription).toContain('该操作会提交异步任务')
    expect(zhDescription).toContain('任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText')
    expect(zhDescription).toContain('完整逐字输出修改后的剧本')
    expect(enDescription).toContain('Use only after the screenplay exists')
    expect(enDescription).toContain('pass revisionInstruction, durationTier, and aspectRatio')
    expect(enDescription).toContain('This operation submits an async task')
    expect(enDescription).toContain('in the terminal follow-up after completion, read the complete screenplayText from project context')
    expect(enDescription).toContain('echo the revised screenplay to the user in chat')
  })

  it('describes style preview generation as regeneratable with capped count and direction', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_style_previews', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_style_previews', 'fallback', 'en')

    expect(zhDescription).toContain('生成或重新生成 1-3 个视觉风格候选图')
    expect(zhDescription).toContain('非真人画风可以包含动漫 3D 或风格化 3D')
    expect(zhDescription).toContain('styleDirection')
    expect(zhDescription).toContain('count 上限为 3')
    expect(enDescription).toContain('Generate or regenerate 1-3')
    expect(enDescription).toContain('non-real-person art direction may include anime 3D or stylized 3D')
    expect(enDescription).toContain('styleDirection')
    expect(enDescription).toContain('count is capped at 3')
  })

  it('describes edit asset generation without wildcard requirement ids', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_script_assets', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_script_assets', 'fallback', 'en')

    expect(zhDescription).toContain('要处理全部需求时不要传 requirementId')
    expect(zhDescription).toContain('真实 editScript.requirements[].id')
    expect(zhDescription).toContain('禁止传 "*" 或任何通配值')
    expect(enDescription).toContain('To process every requirement, omit requirementId')
    expect(enDescription).toContain('exact editScript.requirements[].id')
    expect(enDescription).toContain('Never pass "*" or any wildcard value')
  })

  it('describes edit asset revision as requiring user review notes', () => {
    const zhDescription = localizeSelectableToolDescription('revise_edit_script_assets', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('revise_edit_script_assets', 'fallback', 'en')

    expect(zhDescription).toContain('资产审核未通过')
    expect(zhDescription).toContain('revisionNotes')
    expect(zhDescription).toContain('工具成功返回前')
    expect(enDescription).toContain('after asset review is not approved')
    expect(enDescription).toContain('Pass revisionNotes')
    expect(enDescription).toContain('Do not claim tasks were resubmitted until this tool succeeds')
  })
})
