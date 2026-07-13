import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { callRoute } from '../helpers/call-route'

const authState = vi.hoisted(() => ({ authorized: true }))
const maybeSubmitLLMTaskMock = vi.hoisted(() => vi.fn(
  async (params: Parameters<typeof import('@/lib/llm-observe/route-task').maybeSubmitLLMTask>[0]) => {
    void params
    return NextResponse.json({
      success: true,
      async: true,
      taskId: 'task-transition-1',
      status: 'queued',
      deduped: false,
    })
  },
))
const validateMock = vi.hoisted(() => vi.fn(async (): Promise<{
  firstPanel: {
    id: string
    firstLastFramePrompt: string | null
    firstLastFramePromptSourceFingerprint: string | null
    videoDurationBinding?: string | null
  }
  lastPanel: { id: string }
  episodeId: string
}> => ({
  firstPanel: { id: 'panel-1', firstLastFramePrompt: null, firstLastFramePromptSourceFingerprint: null },
  lastPanel: { id: 'panel-2' },
  episodeId: 'episode-1',
})))
const fingerprintMock = vi.hoisted(() => vi.fn(() => 'fingerprint-current'))
const validationErrorMock = vi.hoisted(() => ({
  ErrorClass: class FirstLastFramePromptValidationError extends Error {},
}))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuthLight: async (projectId: string) => {
    if (!authState.authorized) {
      return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 })
    }
    return {
      session: { user: { id: 'user-1' } },
      project: { id: projectId, userId: 'user-1' },
    }
  },
}))
vi.mock('@/lib/llm-observe/route-task', () => ({
  maybeSubmitLLMTask: maybeSubmitLLMTaskMock,
}))
vi.mock('@/lib/novel-promotion/first-last-frame-prompt', () => ({
  loadAdjacentFirstLastFramePanels: validateMock,
  buildFirstLastFramePromptFingerprint: fingerprintMock,
  FirstLastFramePromptValidationError: validationErrorMock.ErrorClass,
}))

import { POST } from '@/app/api/novel-promotion/[projectId]/first-last-frame-prompt/route'

describe('POST first-last-frame-prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authorized = true
    validateMock.mockResolvedValue({
      firstPanel: { id: 'panel-1', firstLastFramePrompt: null, firstLastFramePromptSourceFingerprint: null },
      lastPanel: { id: 'panel-2' },
      episodeId: 'episode-1',
    })
  })

  it('requires project ownership before inspecting panels', async () => {
    authState.authorized = false

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'link',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(403)
    expect(validateMock).not.toHaveBeenCalled()
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it('validates adjacency and submits only stable IDs plus reason', async () => {
    const response = await callRoute(POST, 'POST', {
      firstPanelId: ' panel-1 ',
      lastPanelId: 'panel-2',
      episodeId: 'episode-1',
      reason: 'source_change',
      firstImageUrl: 'data:image/png;base64,secret',
      lastImageUrl: 'https://signed.example/last.png?token=secret',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(200)
    expect(validateMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      episodeId: 'episode-1',
      requireLinked: true,
    })
    expect(maybeSubmitLLMTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'generate_first_last_frame_prompt',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      body: {
        firstPanelId: 'panel-1',
        lastPanelId: 'panel-2',
        episodeId: 'episode-1',
        reason: 'source_change',
      },
      dedupeKey: 'generate_first_last_frame_prompt:panel-1:panel-2:fingerprint-current',
    }))
    const submitted = maybeSubmitLLMTaskMock.mock.calls[0]?.[0]
    expect(submitted?.body).not.toHaveProperty('firstImageUrl')
    expect(submitted?.body).not.toHaveProperty('lastImageUrl')
  })

  it('returns the matching persisted prompt without submitting an automatic ensure task', async () => {
    validateMock.mockResolvedValueOnce({
      firstPanel: {
        id: 'panel-1',
        firstLastFramePrompt: 'Persisted transition',
        firstLastFramePromptSourceFingerprint: 'fingerprint-current',
      },
      lastPanel: { id: 'panel-2' },
      episodeId: 'episode-1',
    })

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'source_change',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      prompt: 'Persisted transition',
      sourceFingerprint: 'fingerprint-current',
      applied: true,
      fallbackUsed: false,
      warnings: [],
    })
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it('returns persisted smart duration metadata with a matching prompt shortcut', async () => {
    validateMock.mockResolvedValueOnce({
      firstPanel: {
        id: 'panel-1',
        firstLastFramePrompt: 'Persisted transition',
        firstLastFramePromptSourceFingerprint: 'fingerprint-current',
        videoDurationBinding: JSON.stringify({
          mode: 'manual',
          targetDurationSeconds: 8,
          durationSource: 'smart',
          recommendationConfidence: 0.88,
          recommendationReason: '包含移动和镜头推进',
          recommendationFingerprint: 'smart-fp',
        }),
      },
      lastPanel: { id: 'panel-2' },
      episodeId: 'episode-1',
    })

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'source_change',
    }, { params: { projectId: 'project-1' } })

    await expect(response.json()).resolves.toMatchObject({
      prompt: 'Persisted transition',
      smartDuration: {
        durationSeconds: 8,
        confidence: 0.88,
        reason: '包含移动和镜头推进',
        fingerprint: 'smart-fp',
        source: 'smart',
      },
    })
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it('always submits manual regeneration even when the persisted fingerprint matches', async () => {
    validateMock.mockResolvedValueOnce({
      firstPanel: {
        id: 'panel-1',
        firstLastFramePrompt: 'Persisted transition',
        firstLastFramePromptSourceFingerprint: 'fingerprint-current',
      },
      lastPanel: { id: 'panel-2' },
      episodeId: 'episode-1',
    })

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'manual',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(200)
    expect(maybeSubmitLLMTaskMock).toHaveBeenCalledOnce()
  })

  it('submits relink generation even when the persisted fingerprint matches', async () => {
    validateMock.mockResolvedValueOnce({
      firstPanel: {
        id: 'panel-1',
        firstLastFramePrompt: 'Old manual transition',
        firstLastFramePromptSourceFingerprint: 'fingerprint-current',
      },
      lastPanel: { id: 'panel-2' },
      episodeId: 'episode-1',
    })

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'link',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(200)
    expect(maybeSubmitLLMTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        firstPanelId: 'panel-1',
        lastPanelId: 'panel-2',
        reason: 'link',
      },
      dedupeKey: 'generate_first_last_frame_prompt:panel-1:panel-2:fingerprint-current',
    }))
  })

  it('does not return the persisted shortcut after the link was removed', async () => {
    validateMock.mockRejectedValueOnce(new validationErrorMock.ErrorClass('First/last frame link was removed'))

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'source_change',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(400)
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ firstPanelId: '', lastPanelId: 'panel-2', reason: 'link' }],
    [{ firstPanelId: 'panel-1', lastPanelId: 'panel-1', reason: 'link' }],
    [{ firstPanelId: 'panel-1', lastPanelId: 'panel-2', reason: 'other' }],
  ])('rejects malformed request %j', async (body) => {
    const response = await callRoute(POST, 'POST', body, {
      params: { projectId: 'project-1' },
    })

    expect(response.status).toBe(400)
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it('rejects non-adjacent panels without submitting a task', async () => {
    validateMock.mockRejectedValueOnce(new validationErrorMock.ErrorClass('Panels are not adjacent'))

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-3',
      reason: 'manual',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it('preserves infrastructure failures as a server error', async () => {
    validateMock.mockRejectedValueOnce(new Error('database connection lost'))

    const response = await callRoute(POST, 'POST', {
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      reason: 'manual',
    }, { params: { projectId: 'project-1' } })

    expect(response.status).toBe(500)
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })
})
