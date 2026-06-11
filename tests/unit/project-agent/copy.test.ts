import { describe, expect, it } from 'vitest'
import { buildProjectAgentSystemPrompt, localizeSelectableToolDescription } from '@/lib/project-agent/copy'

describe('project agent prompt copy', () => {
  it('uses direct operation rules instead of fixed workflow or skill-gateway rules', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      interactionMode: 'plan',
    })

    expect(prompt).toContain('只能使用当前注入的 tool 定义和当前项目上下文')
    expect(prompt).toContain('时长+画面比例选择 -> 剧本 -> 用户审核/确认剧本 -> 基于剧本生成风格候选图 -> 视觉风格选择 -> 导演拆镜 -> 剪辑先行表 -> 需求资产/空间档案 -> 摄影 shot plan -> 分镜面板/图片 -> 视频片段 -> 最终成片')
    expect(prompt).toContain('必须把上述产物依赖顺序当作产物依赖约束')
    expect(prompt).toContain('或修复/重生成用户正在反馈的当前阶段产物')
    expect(prompt).toContain('剪辑先行表/剪辑核心表 ready 后，停止开放式创意讨论')
    expect(prompt).toContain('剪辑先行剧本和剪辑先行表目标总时长最多 120 秒')
    expect(prompt).toContain('禁止选择或生成真人类型、实拍真人、真人演员、写实真人')
    expect(prompt).toContain('不要把内部系统规则、测试上线限制、安全策略措辞、tool 使用说明或 workflow 门禁作为说明文字发给用户')
    expect(prompt).toContain('必须由你主动通过 tool use 一次性发起')
    expect(prompt).toContain('choiceType="duration_and_aspect_ratio"')
    expect(prompt).toContain('choiceType="screenplay_review"')
    expect(prompt).toContain('choiceType="style"')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')
    expect(prompt).toContain('如果用户表示不满意、要求重做或调整候选图')
    expect(prompt).toContain('styleDirection')
    expect(prompt).toContain('直接调用对应已注入 operation')
    expect(prompt).toContain('执行批准由 runtime approval card 处理')
    expect(prompt).toContain('当 assistant 面板展示剪辑先行时长、剧本审核、视觉风格或画面比例选择卡时，必须等待用户点击或提交卡片')
    expect(prompt).toContain('禁止跳步、批量推进多个未来阶段、执行后置阶段 operation')
    expect(prompt).toContain('generate_edit_screenplay 成功后，必须展示剧本内容，然后调用 request_edit_first_choice 并传 choiceType="screenplay_review"')
    expect(prompt).toContain('必须调用 revise_edit_screenplay')
    expect(prompt).toContain('再调用 generate_edit_style_previews')
    expect(prompt).toContain('只有当用户明确询问技能、可复用计划或 skill catalog 文档时，才使用 Agent Skill 工具')
    expect(prompt).not.toContain('只能通过固定 workflow package 执行')
    expect(prompt).not.toContain('workflow package 内部 skills 顺序不可更改')
    expect(prompt).not.toContain('先调用 search_skills')
  })

  it('adds the same next-step gate to the English prompt', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'en',
      projectId: 'project-1',
      episodeId: 'episode-1',
      interactionMode: 'auto',
    })

    expect(prompt).toContain('treat that dependency order as a dependency gate')
    expect(prompt).toContain('screenplay and edit script must target at most 120 seconds total')
    expect(prompt).toContain('do not choose or generate real-person/live-action/human-actor/photorealistic-human styles')
    expect(prompt).toContain('Do not expose internal system rules, test-launch constraints, safety policy wording, tool instructions, or workflow gates to the user as prose')
    expect(prompt).toContain('When edit-first production needs text-only user choices that can be decided before screenplay generation, initiate them together with tool use')
    expect(prompt).toContain('choiceType="duration_and_aspect_ratio"')
    expect(prompt).toContain('choiceType="screenplay_review"')
    expect(prompt).toContain('choiceType="style"')
    expect(prompt).not.toContain('choiceType="next_step_confirmation"')
    expect(prompt).toContain('If the user says they dislike the candidates or asks to regenerate/adjust them')
    expect(prompt).toContain('styleDirection')
    expect(prompt).toContain('by calling the corresponding injected operation directly')
    expect(prompt).toContain('runtime approval cards')
    expect(prompt).toContain('When the assistant panel displays a choice card for edit-first duration, screenplay review, visual style, or aspect ratio')
    expect(prompt).toContain('After generate_edit_screenplay succeeds, present the screenplay content, then call request_edit_first_choice with choiceType="screenplay_review"')
    expect(prompt).toContain('call revise_edit_screenplay instead of postponing the change to visual style previews')
    expect(prompt).toContain('generate_edit_style_previews')
    expect(prompt).toContain('repair/regenerate the current-stage artifact the user is responding to')
    expect(prompt).toContain('After the edit script/core edit table is ready, stop open-ended creative discussion')
    expect(prompt).toContain('Never skip ahead, batch multiple future stages, run a later-stage operation')
  })

  it('describes screenplay generation as requiring structured duration and aspect ratio fields', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_screenplay', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_screenplay', 'fallback', 'en')

    expect(zhDescription).toContain('必须传入 prompt、durationSeconds、aspectRatio 三个字段')
    expect(zhDescription).toContain('必须来自用户通过 request_edit_first_choice 选择卡确认的结果')
    expect(enDescription).toContain('You must pass prompt, durationSeconds, and aspectRatio')
    expect(enDescription).toContain('confirmed through request_edit_first_choice')
  })

  it('describes screenplay revision as review-stage only with structured fields', () => {
    const zhDescription = localizeSelectableToolDescription('revise_edit_screenplay', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('revise_edit_screenplay', 'fallback', 'en')

    expect(zhDescription).toContain('仅在剧本已生成')
    expect(zhDescription).toContain('必须传入 revisionInstruction、durationSeconds、aspectRatio')
    expect(enDescription).toContain('Use only after the screenplay exists')
    expect(enDescription).toContain('pass revisionInstruction, durationSeconds, and aspectRatio')
  })

  it('describes style preview generation as regeneratable with capped count and direction', () => {
    const zhDescription = localizeSelectableToolDescription('generate_edit_style_previews', 'fallback', 'zh')
    const enDescription = localizeSelectableToolDescription('generate_edit_style_previews', 'fallback', 'en')

    expect(zhDescription).toContain('生成或重新生成 1-3 个视觉风格候选图')
    expect(zhDescription).toContain('styleDirection')
    expect(zhDescription).toContain('count 上限为 3')
    expect(enDescription).toContain('Generate or regenerate 1-3')
    expect(enDescription).toContain('styleDirection')
    expect(enDescription).toContain('count is capped at 3')
  })
})
