import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildVideoSeamDraftStorageKey,
  createRecoveredVideoSeamTask,
  readVideoSeamDraft,
  writeVideoSeamDraft,
  type VideoSeamDraft,
} from '@/app/[locale]/workspace/video-tools/video-seam-draft'
import {
  canSubmitVideoSeamConcat,
  resolveVideoToolTaskView,
} from '@/app/[locale]/workspace/video-tools/video-tools-state'

const input1 = {
  key: 'video-tools/user-1/inputs/one.mp4',
  url: '/api/storage/sign?key=one',
  name: 'one.mp4',
  size: 1024,
  mimeType: 'video/mp4',
}

const draft: VideoSeamDraft = {
  input1,
  input2: {
    key: 'video-tools/user-1/inputs/two.mp4',
    url: '/api/storage/sign?key=two',
    name: 'two.mp4',
    size: 2048,
    mimeType: 'video/mp4',
  },
  input1TrimEndFrames: 2,
  input2TrimStartFrames: 3,
  seamMode: 'ai_bridge',
  bridgeDurationSeconds: 6,
  bridgePrompt: 'Preserve the moving subject.',
  taskId: 'task-1',
}

function installStorage(initialEntries: Array<[string, string]> = []) {
  const state = new Map(initialEntries)
  const localStorage = {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => state.set(key, value)),
  }
  vi.stubGlobal('window', { localStorage })
  return { localStorage, state }
}

describe('video seam draft storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists only approved draft metadata under a stable authenticated-user key', () => {
    const { localStorage, state } = installStorage()

    writeVideoSeamDraft(' user-1 ', {
      ...draft,
      secret: 'must-not-persist',
    } as VideoSeamDraft & { secret: string })

    const key = buildVideoSeamDraftStorageKey('user-1')
    expect(key).toContain('user-1')
    expect(localStorage.setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(state.get(key) || '{}')).toEqual({
      version: 1,
      userId: 'user-1',
      ...draft,
    })
    expect(readVideoSeamDraft('user-1')).toEqual(draft)
  })

  it('keeps drafts isolated by authenticated user even when another key contains valid JSON', () => {
    const { localStorage } = installStorage()
    writeVideoSeamDraft('user-1', draft)

    expect(readVideoSeamDraft('user-2')).toBeNull()
    expect(localStorage.getItem).toHaveBeenLastCalledWith(buildVideoSeamDraftStorageKey('user-2'))
  })

  it('hydrates a stored draft with a five-second AI bridge', () => {
    installStorage([[buildVideoSeamDraftStorageKey('user-1'), JSON.stringify({
      version: 1,
      userId: 'user-1',
      ...draft,
      bridgeDurationSeconds: 5,
    })]])

    expect(readVideoSeamDraft('user-1')).toMatchObject({ bridgeDurationSeconds: 5 })
  })

  it.each([
    ['malformed JSON', '{bad json'],
    ['wrong version', JSON.stringify({ version: 2, userId: 'user-1', ...draft })],
    ['cross-user payload', JSON.stringify({ version: 1, userId: 'user-2', ...draft })],
    ['invalid upload metadata', JSON.stringify({ version: 1, userId: 'user-1', ...draft, input1: { ...input1, size: -1 } })],
    ['invalid trim', JSON.stringify({ version: 1, userId: 'user-1', ...draft, input2TrimStartFrames: 0.5 })],
    ['invalid seam mode', JSON.stringify({ version: 1, userId: 'user-1', ...draft, seamMode: 'crossfade' })],
    ['invalid bridge duration', JSON.stringify({ version: 1, userId: 'user-1', ...draft, bridgeDurationSeconds: 7 })],
    ['blank task id', JSON.stringify({ version: 1, userId: 'user-1', ...draft, taskId: ' ' })],
  ])('rejects %s without hydrating partial state', (_case, stored) => {
    installStorage([[buildVideoSeamDraftStorageKey('user-1'), stored]])

    expect(readVideoSeamDraft('user-1')).toBeNull()
  })

  it('does not access browser storage without a resolved authenticated user id', () => {
    const { localStorage } = installStorage()

    expect(readVideoSeamDraft('  ')).toBeNull()
    writeVideoSeamDraft('', draft)

    expect(localStorage.getItem).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('normalizes every stored free-form string before hydrating state', () => {
    installStorage([[
      buildVideoSeamDraftStorageKey('user-1'),
      JSON.stringify({
        version: 1,
        userId: 'user-1',
        ...draft,
        input1: {
          key: ' video-tools/user-1/inputs/one.mp4 ',
          url: ' /api/storage/sign?key=one ',
          name: ' one.mp4 ',
          size: 1024,
          mimeType: ' video/mp4 ',
        },
        bridgePrompt: ' Preserve the moving subject. ',
        taskId: ' task-1 ',
      }),
    ]])

    expect(readVideoSeamDraft('user-1')).toMatchObject({
      input1: {
        key: 'video-tools/user-1/inputs/one.mp4',
        url: '/api/storage/sign?key=one',
        name: 'one.mp4',
        mimeType: 'video/mp4',
      },
      bridgePrompt: 'Preserve the moving subject.',
      taskId: 'task-1',
    })
  })

  it('creates an active queued placeholder for an immediately recovered server task', () => {
    const task = createRecoveredVideoSeamTask(' task-1 ')

    expect(task).toEqual({
      id: 'task-1',
      status: 'queued',
      progress: 0,
      payload: null,
      result: null,
      error: null,
    })
    expect(resolveVideoToolTaskView(task)).toMatchObject({ phase: 'queued', active: true })
    expect(canSubmitVideoSeamConcat(input1, draft.input2, task)).toBe(false)
  })
})
