import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: {
    findFirst: vi.fn(async () => ({ videoRatio: '16:9' })),
    update: vi.fn(async () => ({ id: 'project-1' })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  projectEditBible: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  $transaction: vi.fn(async (operations: readonly Promise<unknown>[]) => await Promise.all(operations)),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  applyEditFirstChoiceResultSideEffects,
  buildEditFirstChoiceResult,
} from '@/lib/project-agent/edit-first-choice-result'
import { approveProjectEpisodeEditScriptAssets } from '@/lib/edit-script/service'
import { approveEpisodePromptGeneratedScript, confirmEpisodeEditBible } from '@/lib/edit-bible'

vi.mock('@/lib/edit-script/service', () => ({
  approveProjectEpisodeEditScriptAssets: vi.fn(async () => undefined),
}))

vi.mock('@/lib/edit-bible', () => ({
  approveEpisodePromptGeneratedScript: vi.fn(async () => undefined),
  confirmEpisodeEditBible: vi.fn(async () => ({ id: 'bible-1' })),
}))

const approveProjectEpisodeEditScriptAssetsMock = vi.mocked(approveProjectEpisodeEditScriptAssets)
const approveEpisodePromptGeneratedScriptMock = vi.mocked(approveEpisodePromptGeneratedScript)
const confirmEpisodeEditBibleMock = vi.mocked(confirmEpisodeEditBible)

function readSyntheticToolResult(choiceResult: ReturnType<typeof buildEditFirstChoiceResult>): {
  callId: string
  name: string
  parsed: Record<string, unknown>
} {
  expect(choiceResult).not.toBeNull()
  const [callItem, resultItem] = choiceResult!.inputItems as Array<Record<string, unknown>>
  expect(callItem.type).toBe('function_call')
  expect(resultItem.type).toBe('function_call_result')
  expect(callItem.callId).toBe(resultItem.callId)
  const output = resultItem.output as { type: string; text: string }
  expect(output.type).toBe('text')
  return {
    callId: String(resultItem.callId),
    name: String(resultItem.name),
    parsed: JSON.parse(output.text) as Record<string, unknown>,
  }
}

describe('buildEditFirstChoiceResult', () => {
  beforeEach(() => {
    approveProjectEpisodeEditScriptAssetsMock.mockClear()
    approveEpisodePromptGeneratedScriptMock.mockClear()
    confirmEpisodeEditBibleMock.mockClear()
    prismaMock.project.updateMany.mockClear()
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 })
  })

  it('serializes script intake answers as a normalized brief without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'script_intake',
      toolCallId: 'tool-call-1',
      latestUserText: '恐怖故事',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          subgenre: 'folk_horror',
          setting: 'old_village',
        },
        labels: {
          subgenreLabel: '民俗恐怖',
          settingLabel: '偏远旧村',
        },
        freeText: '主角是返乡参加葬礼的姐姐。',
      },
    })

    const { name, parsed } = readSyntheticToolResult(choiceResult)
    expect(name).toBe('request_script_intake_choice')
    expect(parsed.decision).toBe('submit')
    expect(parsed.normalizedBrief).toBe([
      '恐怖故事',
      '- 民俗恐怖',
      '- 偏远旧村',
      '主角是返乡参加葬礼的姐姐。',
    ].join('\n'))
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes bible approval with the selected aspect ratio without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: '16:9',
        },
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('approve')
    expect(parsed.aspectRatio).toBe('16:9')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes bible revision notes without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '更克苏鲁一些',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.nextOperationId).toBeUndefined()
    expect(parsed.revisionNotes).toBe('更克苏鲁一些')
  })

  it('serializes script approval without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
      latestUserText: '确认剧本',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    const { name, parsed } = readSyntheticToolResult(choiceResult)
    expect(name).toBe('request_edit_script_review_choice')
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes script revision notes without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'script_review',
      toolCallId: 'tool-call-script',
      latestUserText: '结尾太暖',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '结尾更冷峻，不要解释因果悖论',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('revise')
    expect(parsed.revisionNotes).toBe('结尾更冷峻，不要解释因果悖论')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes style selection without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        stylePreviewId: 'style-1',
        aspectRatio: '9:16',
      },
    })

    const { callId, parsed } = readSyntheticToolResult(choiceResult)
    expect(callId).toMatch(/^edit_first_choice_/)
    expect(parsed.stylePreviewId).toBe('style-1')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes asset review approval without selecting the next operation', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'approve',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('approve')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('serializes asset review revision notes without approving assets', () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: 'tool-call-1',
      latestUserText: '场景太现代',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
      },
    })

    const { parsed } = readSyntheticToolResult(choiceResult)
    expect(parsed.decision).toBe('revise')
    expect(parsed.revisionNotes).toBe('把祠堂场景调得更旧，空间关系更压迫')
    expect(parsed.nextOperationId).toBeUndefined()
  })

  it('persists approved bible review without submitting billable visual-style tasks', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'bible_review',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: '21:9',
        },
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(prismaMock.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        userId: 'user-1',
      },
      data: {
        videoRatio: '21:9',
      },
    })
    expect(confirmEpisodeEditBibleMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('persists approved script review as an explicit script approval edge', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'script_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveEpisodePromptGeneratedScriptMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('does not approve script review when the user requests revision', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'script_review',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '换一个结局',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveEpisodePromptGeneratedScriptMock).not.toHaveBeenCalled()
  })

  it('rejects bible approval without a selected aspect ratio', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '确认',
      output: {
        ok: true,
        decision: 'approve',
      },
    })).toBeNull()
  })

  it('does not confirm bible review when approval is missing the selected aspect ratio', async () => {
    await expect(applyEditFirstChoiceResultSideEffects({
      choiceType: 'bible_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })).rejects.toThrow('PROJECT_AGENT_BIBLE_REVIEW_ASPECT_RATIO_REQUIRED')

    expect(prismaMock.project.updateMany).not.toHaveBeenCalled()
    expect(confirmEpisodeEditBibleMock).not.toHaveBeenCalled()
  })

  it('rejects a bible review without a decision', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-call-1',
      latestUserText: '生成一部科幻短片',
      output: {
        ok: true,
      },
    })).toBeNull()
  })

  it('rejects a style selection without a preview id', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'style',
      toolCallId: null,
      latestUserText: '生成一部民俗恐怖短片',
      output: {
        ok: true,
        aspectRatio: '9:16',
      },
    })).toBeNull()
  })

  it('rejects asset review revision without notes', () => {
    expect(buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: null,
      latestUserText: '继续',
      output: {
        ok: true,
        decision: 'revise',
      },
    })).toBeNull()
  })

  it('persists approved asset review as the user decision without selecting the next operation', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: true,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEpisodeEditScriptAssetsMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
  })

  it('does not persist asset review when the user has not approved assets', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: true,
        decision: 'revise',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEpisodeEditScriptAssetsMock).not.toHaveBeenCalled()
  })

  it('does not persist asset review from a failed choice result', async () => {
    await applyEditFirstChoiceResultSideEffects({
      choiceType: 'asset_review',
      output: {
        ok: false,
        decision: 'approve',
      },
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(approveProjectEpisodeEditScriptAssetsMock).not.toHaveBeenCalled()
  })
})
