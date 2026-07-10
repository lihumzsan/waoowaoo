import { describe, expect, it } from 'vitest'
import { readNextActionFromSessionState } from '../../../scripts/e2e-long-form/actions'
import type { E2eRunnerConfig } from '../../../scripts/e2e-long-form/types'

const baseConfig: E2eRunnerConfig = {
  mode: 'live',
  target: 'assets_approved',
  generation: 'real',
  baseUrl: 'http://localhost:3000',
  locale: 'zh',
  username: null,
  password: null,
  sessionCookie: 'session=1',
  prompt: 'prompt',
  projectName: 'project',
  episodeName: 'episode',
  projectId: null,
  episodeId: null,
  aspectRatio: '16:9',
  assistantPermissionMode: 'ask',
  pollIntervalMs: 1000,
  stageTimeoutMs: 1000,
  overallTimeoutMs: 2000,
  reportDir: '/tmp/e2e',
}

describe('long-form E2E action reader', () => {
  it('submits bible review with the configured aspect ratio', () => {
    const action = readNextActionFromSessionState(baseConfig, {
      sessionState: {
        pendingInteraction: {
          kind: 'choice',
          runId: 'run-1',
          interruptionId: 'interrupt-1',
          choiceType: 'bible_review',
          toolCallId: 'tool-1',
          choiceCard: { groups: [] },
        },
      },
    })

    expect(action).toEqual({
      kind: 'choice',
      action: {
        runId: 'run-1',
        interruptionId: 'interrupt-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-1',
        output: {
          ok: true,
          decision: 'approve',
          selections: {
            aspectRatio: '16:9',
          },
        },
      },
    })
  })

  it('selects the first style preview option through the choice API payload', () => {
    const action = readNextActionFromSessionState(baseConfig, {
      sessionState: {
        pendingInteraction: {
          kind: 'choice',
          runId: 'run-1',
          interruptionId: 'interrupt-1',
          choiceType: 'style',
          toolCallId: null,
          choiceCard: {
            submit: { aspectRatio: '9:16' },
            groups: [{
              key: 'stylePreviewId',
              options: [
                { value: 'style-1' },
                { value: 'style-2' },
              ],
            }],
          },
        },
      },
    })

    expect(action?.kind).toBe('choice')
    if (action?.kind !== 'choice') throw new Error('choice action expected')
    expect(action.action.output).toEqual({
      ok: true,
      stylePreviewId: 'style-1',
      aspectRatio: '9:16',
    })
  })
})
