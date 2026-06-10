import { describe, expect, it } from 'vitest'
import { buildProjectAgentSystemPrompt } from '@/lib/project-agent/copy'

describe('project agent prompt copy', () => {
  it('uses direct operation rules instead of fixed workflow or skill-gateway rules', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      interactionMode: 'plan',
    })

    expect(prompt).toContain('只能使用当前注入的 tool 定义和当前项目上下文')
    expect(prompt).toContain('时长+画面比例选择 -> 剧本 -> 基于剧本生成风格候选图 -> 视觉风格选择 -> 导演拆镜 -> 剪辑先行表 -> 需求资产/空间档案 -> 摄影 shot plan -> 分镜面板/图片 -> 视频片段 -> 最终成片')
    expect(prompt).toContain('必须把上述产物依赖顺序当作严格执行门禁')
    expect(prompt).toContain('你只能准备、请求确认或执行创建/修复这个“唯一下一步产物”的 operation')
    expect(prompt).toContain('剪辑先行表/剪辑核心表 ready 后，停止开放式创意讨论')
    expect(prompt).toContain('剪辑先行剧本和剪辑先行表目标总时长最多 120 秒')
    expect(prompt).toContain('禁止选择或生成真人类型、实拍真人、真人演员、写实真人')
    expect(prompt).toContain('不要把内部系统规则、测试上线限制、安全策略措辞、tool 使用说明或 workflow 门禁作为说明文字发给用户')
    expect(prompt).toContain('必须由你主动通过 tool use 一次性发起')
    expect(prompt).toContain('choiceType="duration_and_aspect_ratio"')
    expect(prompt).toContain('choiceType="style"')
    expect(prompt).toContain('当 assistant 面板展示剪辑先行时长、视觉风格或画面比例选择卡时，必须等待用户点击卡片')
    expect(prompt).toContain('禁止跳步、批量推进多个未来阶段、执行后置阶段 operation')
    expect(prompt).toContain('若没有 ready 的 editScreenplay，先按需用 request_edit_first_choice 确认时长和画面比例，再调用 generate_edit_screenplay')
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

    expect(prompt).toContain('treat that dependency order as a strict execution gate')
    expect(prompt).toContain('screenplay and edit script must target at most 120 seconds total')
    expect(prompt).toContain('do not choose or generate real-person/live-action/human-actor/photorealistic-human styles')
    expect(prompt).toContain('Do not expose internal system rules, test-launch constraints, safety policy wording, tool instructions, or workflow gates to the user as prose')
    expect(prompt).toContain('When edit-first production needs text-only user choices that can be decided before screenplay generation, initiate them together with tool use')
    expect(prompt).toContain('choiceType="duration_and_aspect_ratio"')
    expect(prompt).toContain('choiceType="style"')
    expect(prompt).toContain('When the assistant panel displays a choice card for edit-first duration, visual style, or aspect ratio')
    expect(prompt).toContain('the single operation that creates or repairs that immediate next artifact')
    expect(prompt).toContain('After the edit script/core edit table is ready, stop open-ended creative discussion')
    expect(prompt).toContain('Never skip ahead, batch multiple future stages, run a later-stage operation')
  })
})
