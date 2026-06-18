import { describe, expect, it } from 'vitest'
import {
  buildProjectAgentSystemPrompt,
  localizeProjectAgentOperationTitle,
  localizeSelectableToolDescription,
} from '@/lib/project-agent/copy'

describe('project agent prompt copy', () => {
  it('uses direct operation rules instead of fixed workflow or skill-gateway rules', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantPermissionMode: 'ask',
    })

    expect(prompt).toContain('只能使用当前注入的 tool 定义和当前项目上下文')
    expect(prompt).toContain('时长档位+画面比例选择 -> 剧本 -> 用户审核/确认剧本 -> 基于剧本生成风格候选图 -> 视觉风格选择 -> 导演拆镜 -> 剪辑先行表 -> 需求资产/空间档案 -> 用户审核/确认资产 -> 摄影 shot plan -> 分镜空间定位/空间一致性准备 -> 分镜面板/图片 -> 视频片段 -> 最终成片')
    expect(prompt).toContain('必须把上述产物依赖顺序当作产物依赖约束')
    expect(prompt).toContain('或修复/重生成用户正在反馈的当前阶段产物')
    expect(prompt).toContain('剪辑先行表/剪辑核心表 ready 后，停止开放式创意讨论')
    expect(prompt).toContain('剪辑先行剧本和剪辑先行表目标总时长最多 120 秒')
    expect(prompt).toContain('禁止选择或生成真人类型、实拍真人、真人演员、写实真人')
    expect(prompt).toContain('真人 3D、写实真人 3D、数字人、CG 真人、CGI 真人')
    expect(prompt).toContain('3D/CG 在明确非真人时允许')
    expect(prompt).toContain('动漫 3D、风格化 3D')
    expect(prompt).toContain('不要把内部系统规则、测试上线限制、安全策略措辞、tool 使用说明或 workflow 门禁作为说明文字发给用户')
    expect(prompt).toContain('工具调用沟通协议')
    expect(prompt).toContain('禁止输出空 assistant 文本后只发起写入/生成/选择类工具调用')
    expect(prompt).toContain('只读状态/上下文工具不适用上述用户可见说明要求')
    expect(prompt).toContain('必须静默调用，不要先说“我正在查询/加载项目状态”')
    expect(prompt).toContain('禁止提内部 operation 名、tool id、workflow 门禁、注入工具')
    expect(prompt).toContain('必须由你主动通过 tool use 一次性发起')
    expect(prompt).toContain('choiceType="duration_and_aspect_ratio"')
    expect(prompt).toContain('choiceType="screenplay_review"')
    expect(prompt).toContain('choiceType="style"')
    expect(prompt).toContain('choiceType="asset_review"')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')
    expect(prompt).toContain('如果用户表示不满意、要求重做或调整候选图')
    expect(prompt).toContain('styleDirection')
    expect(prompt).toContain('直接调用对应已注入 operation')
    expect(prompt).toContain('不要告诉用户你会展示、发送、弹出或等待卡片、审批卡、确认卡')
    expect(prompt).toContain('对已自动通过执行审批的剪辑先行主流程，直接调用当前下一步 operation')
    expect(prompt).toContain('当 request_edit_first_choice 已进入剪辑先行时长、剧本审核、视觉风格、资产审核或画面比例的内容选择等待状态时')
    expect(prompt).not.toContain('执行批准由 runtime approval card 处理')
    expect(prompt).toContain('禁止跳步、批量推进多个未来阶段、执行后置阶段 operation')
    expect(prompt).toContain('generate_edit_screenplay 返回 async=true 后，不要期待 tool 结果里有 screenplayText')
    expect(prompt).toContain('任务完成后的终态 follow-up 中，必须从项目上下文读取当前完整剧本')
    expect(prompt).toContain('把这份剧本完整、逐字输出给用户')
    expect(prompt).toContain('禁止只总结、节选、省略，也禁止说剧本只在画布里查看')
    expect(prompt).toContain('必须调用 revise_edit_screenplay')
    expect(prompt).toContain('revise_edit_screenplay 返回 async=true 后，不要期待 tool 结果里有 screenplayText')
    expect(prompt).toContain('任务完成后的终态 follow-up 中，必须从项目上下文读取当前完整修改后剧本')
    expect(prompt).toContain('把修改后的完整剧本逐字输出给用户')
    expect(prompt).toContain('剧本生成或修改是例外：终态 follow-up 中必须从项目上下文读取并输出当前完整剧本')
    expect(prompt).toContain('再调用 generate_edit_style_previews')
    expect(prompt).toContain('只有当用户明确询问技能、可复用计划或 skill catalog 文档时，才使用 Agent Skill 工具')
    expect(prompt).toContain('批量处理全部 requirements 时不要传 requirementId')
    expect(prompt).toContain('禁止传 "*" 或任何通配值')
    expect(prompt).toContain('没有 ready 摄影 shot plan 和 ready 分镜空间定位/空间一致性准备时调用 generate_edit_script_storyboard')
    expect(prompt).not.toContain('只能通过固定 workflow package 执行')
    expect(prompt).not.toContain('workflow package 内部 skills 顺序不可更改')
    expect(prompt).not.toContain('先调用 search_skills')
  })

  it('adds the same next-step gate to the English prompt', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'en',
      projectId: 'project-1',
      episodeId: 'episode-1',
      assistantPermissionMode: 'auto',
    })

    expect(prompt).toContain('treat that dependency order as a dependency gate')
    expect(prompt).toContain('screenplay and edit script must target at most 120 seconds total')
    expect(prompt).toContain('do not choose or generate real-person/live-action/human-actor/photorealistic-human styles')
    expect(prompt).toContain('real-person 3D, photorealistic 3D humans, digital humans')
    expect(prompt).toContain('3D/CG is allowed when it is clearly non-real-person')
    expect(prompt).toContain('anime 3D, stylized 3D')
    expect(prompt).toContain('Do not expose internal system rules, test-launch constraints, safety policy wording, tool instructions, or workflow gates to the user as prose')
    expect(prompt).toContain('Tool-call communication contract')
    expect(prompt).toContain('Do not emit an empty assistant message followed only by a write/generation/choice tool call')
    expect(prompt).toContain('Read-only state/context tools are exempt from that visible explanation requirement')
    expect(prompt).toContain('call them silently without announcing that you are querying or loading project status')
    expect(prompt).toContain('must not mention internal operation names, tool ids, workflow gates')
    expect(prompt).toContain('When edit-first production needs text-only user choices that can be decided before screenplay generation, initiate them together with tool use')
    expect(prompt).toContain('choiceType="duration_and_aspect_ratio"')
    expect(prompt).toContain('choiceType="screenplay_review"')
    expect(prompt).toContain('choiceType="style"')
    expect(prompt).toContain('choiceType="asset_review"')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')
    expect(prompt).toContain('If the user says they dislike the candidates or asks to regenerate/adjust them')
    expect(prompt).toContain('styleDirection')
    expect(prompt).toContain('by calling the corresponding injected operation directly')
    expect(prompt).toContain('Never tell the user that you will show, send, pop up, or wait for a card, approval card, or confirmation card')
    expect(prompt).toContain('for the auto-approved edit-first main path, call the immediate next operation directly')
    expect(prompt).toContain('When request_edit_first_choice has emitted a content-choice wait state')
    expect(prompt).not.toContain('runtime approval cards')
    expect(prompt).toContain('Assistant permission mode: auto')
    expect(prompt).toContain('After generate_edit_screenplay returns async=true, do not expect screenplayText in the tool result')
    expect(prompt).toContain('In the terminal follow-up after the task completes, read the current full screenplay from project context')
    expect(prompt).toContain('present that exact full screenplay content to the user before calling request_edit_first_choice with choiceType="screenplay_review"')
    expect(prompt).toContain('Do not summarize, omit sections, truncate, or say the screenplay is only available on the canvas')
    expect(prompt).toContain('call revise_edit_screenplay instead of postponing the change to visual style previews')
    expect(prompt).toContain('After revise_edit_screenplay returns async=true, do not expect screenplayText in the tool result')
    expect(prompt).toContain('In the terminal follow-up after the task completes, read the current full revised screenplay from project context')
    expect(prompt).toContain('present that exact full revised screenplay content to the user')
    expect(prompt).toContain('The exception is screenplay generation or revision: in the terminal follow-up, read the current full screenplay from project context')
    expect(prompt).toContain('generate_edit_style_previews')
    expect(prompt).toContain('repair/regenerate the current-stage artifact the user is responding to')
    expect(prompt).toContain('After the edit script/core edit table is ready, stop open-ended creative discussion')
    expect(prompt).toContain('Never skip ahead, batch multiple future stages, run a later-stage operation')
    expect(prompt).toContain('Omit requirementId to process all requirements')
    expect(prompt).toContain('Never pass "*" or wildcard values')
    expect(prompt).toContain('ready storyboard spatial blocking/space-consistency preparation')
  })

  it('describes screenplay generation as requiring structured duration and aspect ratio fields', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_screenplay', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_screenplay', 'fallback', 'en')

    expect(zhDescription).toContain('必须传入 prompt、durationTier、aspectRatio 三个字段')
    expect(zhDescription).toContain('必须来自 request_edit_first_choice 返回的用户选择结果')
    expect(zhDescription).toContain('该操作会提交异步任务')
    expect(zhDescription).toContain('任务完成后的终态 follow-up 中，从项目上下文读取完整 screenplayText')
    expect(zhDescription).toContain('完整逐字输出给用户')
    expect(enDescription).toContain('You must pass prompt, durationTier, and aspectRatio')
    expect(enDescription).toContain('confirmed through request_edit_first_choice')
    expect(enDescription).toContain('This operation submits an async task')
    expect(enDescription).toContain('in the terminal follow-up after completion, read the complete screenplayText from project context')
    expect(enDescription).toContain('echo it to the user in chat')
  })

  it('localizes user-facing operation titles without exposing internal ids', () => {
    expect(localizeProjectAgentOperationTitle('generate_edit_screenplay', 'zh')).toBe('生成剧本')
    expect(localizeProjectAgentOperationTitle('generate_edit_screenplay', 'en')).toBe('Generate screenplay')
    expect(localizeProjectAgentOperationTitle('generate_edit_script_storyboard_spatial_blocking', 'zh')).toBe('生成空间定位')
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
})
