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

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { applyEditFirstChoiceResultSideEffects, buildEditFirstChoiceResult } from '@/lib/project-agent/edit-first-choice-result'
export { approveProjectEpisodeEditScriptAssets } from '@/lib/edit-script/service'
export { approveEpisodePromptGeneratedScript, confirmEpisodeEditBible } from '@/lib/edit-bible'
export { approveEpisodePromptGeneratedScriptMock, approveProjectEpisodeEditScriptAssetsMock, confirmEpisodeEditBibleMock, prismaMock, readSyntheticToolResult }
