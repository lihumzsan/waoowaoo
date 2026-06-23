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
    expect(prompt).toContain('读取本轮注入的项目状态')
    expect(prompt).toContain('[project_state_snapshot]')
    expect(prompt).toContain('不要默认调用 get_project_phase')
    expect(prompt).not.toContain('读取当前项目阶段和上下文：调用 get_project_phase')
    expect(prompt).toContain('时长与画面比例选择')
    expect(prompt).toContain('用户审核剧本')
    expect(prompt).toContain('视觉风格候选图')
    expect(prompt).toContain('分镜空间定位')
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
    expect(prompt).toContain('从项目上下文读取当前完整剧本')
    expect(prompt).toContain('逐字、完整地输出剧本全文')
    expect(prompt).toContain('调用剧本修改工具，不要把这些修改推迟到视觉风格阶段')
    expect(prompt).toContain('如果用户提交资产修改意见，把它当作未通过审核')
    expect(prompt).toContain('批量处理全部需求时不要传 requirementId')
    expect(prompt).toContain('禁止传 "*" 或任何通配值')
    expect(prompt).toContain('没有 ready 的摄影 shot plan 和分镜空间定位时，不要生成正式分镜')
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
    expect(prompt).toContain('Read the project state injected for this turn')
    expect(prompt).toContain('[project_state_snapshot]')
    expect(prompt).toContain('Do not call get_project_phase by default')
    expect(prompt).not.toContain('Read the current project phase and context: call get_project_phase')
    expect(prompt).toContain('duration and aspect-ratio choice')
    expect(prompt).toContain('user screenplay review')
    expect(prompt).toContain('visual style preview images')
    expect(prompt).toContain('storyboard spatial blocking')
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
    expect(prompt).toContain('Read the current full screenplay from project context')
    expect(prompt).toContain('full screenplay verbatim')
    expect(prompt).toContain('call the screenplay revision tool; do not defer those changes to the visual style stage')
    expect(prompt).toContain('Current permission mode: auto')
    expect(prompt).toContain('Do not skip the current stage to run a later one')
    expect(prompt).toContain('Do not batch-advance multiple future stages')
    expect(prompt).toContain('If the user submits asset revision notes, treat the review as not approved')
    expect(prompt).toContain('omit requirementId to process all requirements')
    expect(prompt).toContain('never pass "*" or any wildcard value')
    expect(prompt).toContain('Do not generate formal storyboard panels without a ready cinematography shot plan and ready storyboard spatial blocking')
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

  it('localizes user-facing operation titles without exposing internal ids', () => {
    for (const operationId of EDIT_FIRST_WORKFLOW_OPERATION_IDS) {
      expect(localizeProjectAgentOperationTitle(operationId, 'zh')).not.toBe('项目操作')
      expect(localizeProjectAgentOperationTitle(operationId, 'en')).not.toBe('Project operation')
    }

    expect(localizeProjectAgentOperationTitle('generate_edit_screenplay', 'zh')).toBe('生成剧本')
    expect(localizeProjectAgentOperationTitle('generate_edit_screenplay', 'en')).toBe('Generate screenplay')
    expect(localizeProjectAgentOperationTitle('generate_edit_cinematography_shot_plan', 'zh')).toBe('生成摄影方案')
    expect(localizeProjectAgentOperationTitle('generate_edit_cinematography_shot_plan', 'en')).toBe('Generate cinematography shot plan')
    expect(localizeProjectAgentOperationTitle('generate_edit_script_storyboard_spatial_blocking', 'zh')).toBe('生成空间一致性提示')
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
