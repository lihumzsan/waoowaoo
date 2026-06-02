import { describe, expect, it } from 'vitest'
import { buildProjectAgentSystemPrompt } from '@/lib/project-agent/copy'

describe('project agent prompt copy', () => {
  it('uses direct operation rules instead of fixed workflow or skill-gateway rules', () => {
    const prompt = buildProjectAgentSystemPrompt({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      stage: 'concept',
      interactionMode: 'plan',
    })

    expect(prompt).toContain('只能使用当前注入的 tool 定义和当前项目上下文')
    expect(prompt).toContain('剧本 -> 导演拆镜 -> 剪辑先行表 -> 需求资产/空间档案 -> 摄影 shot plan -> 分镜面板/图片 -> 视频片段 -> 最终成片')
    expect(prompt).toContain('若没有 ready 的 editScreenplay，先调用 generate_edit_screenplay')
    expect(prompt).toContain('只有当用户明确询问技能、可复用计划或 skill catalog 文档时，才使用 Agent Skill 工具')
    expect(prompt).not.toContain('只能通过固定 workflow package 执行')
    expect(prompt).not.toContain('workflow package 内部 skills 顺序不可更改')
    expect(prompt).not.toContain('先调用 search_skills')
  })
})
