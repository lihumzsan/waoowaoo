// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import * as React from 'react'
import { createElement, StrictMode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildVideoSeamDraftStorageKey, type VideoSeamDraft } from '@/app/[locale]/workspace/video-tools/video-seam-draft'

const pageMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  routerPush: vi.fn(),
  session: {
    data: { user: { id: 'user-1' } } as { user: { id: string } } | null,
    status: 'authenticated' as 'authenticated' | 'loading' | 'unauthenticated',
  },
  translate: (key: string) => key,
}))

vi.mock('next-auth/react', () => ({
  useSession: () => pageMocks.session,
}))

vi.mock('next-intl', () => ({
  useTranslations: () => pageMocks.translate,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pageMocks.routerPush }),
}))

vi.mock('@/lib/api-fetch', () => ({ apiFetch: pageMocks.apiFetch }))

vi.mock('@/components/Navbar', () => ({ default: () => createElement('nav') }))
vi.mock('@/app/[locale]/workspace/video-tools/VideoUploadCard', () => ({
  default: (props: {
    label: string
    value: { name: string } | null
    trimFrames: number | ''
  }) => createElement('div', {
    'data-upload-card': true,
    'data-label': props.label,
    'data-upload-name': props.value?.name || '',
    'data-trim-frames': String(props.trimFrames),
  }),
}))
vi.mock('@/app/[locale]/workspace/video-tools/FreeVoiceToolCard', () => ({
  default: () => createElement('section', { 'data-free-voice-tool': true }, 'freeVoice.title'),
}))

import VideoToolsPage from '@/app/[locale]/workspace/video-tools/page'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const storedDraft: VideoSeamDraft = {
  input1: {
    key: 'video-tools/user-1/inputs/one.mp4',
    url: '/api/storage/sign?key=one',
    name: 'one.mp4',
    size: 1024,
    mimeType: 'video/mp4',
  },
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
  bridgePrompt: 'Preserve motion.',
  taskId: 'task-1',
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function storedValue(userId: string, draft: VideoSeamDraft): string {
  return JSON.stringify({ version: 1, userId, ...draft })
}

function installBrowserStorage(entries: Array<[string, string]> = []) {
  const state = new Map(entries)
  const localStorage = {
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => state.set(key, value)),
  }
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  })
  return { localStorage, state }
}

async function mountPage(strict = false): Promise<RenderResult> {
  let renderer!: RenderResult
  await act(async () => {
    renderer = render(strict
      ? createElement(StrictMode, null, createElement(VideoToolsPage))
      : createElement(VideoToolsPage))
    await Promise.resolve()
  })
  return renderer
}

async function resolveRequest(request: Deferred<Response>, response: Response): Promise<void> {
  await act(async () => {
    request.resolve(response)
    await request.promise
    await Promise.resolve()
  })
}

async function rejectRequest(request: Deferred<Response>, error: unknown): Promise<void> {
  await act(async () => {
    request.reject(error)
    await request.promise.catch(() => undefined)
    await Promise.resolve()
  })
}

function readPersistedDraft(state: Map<string, string>, userId = 'user-1') {
  return JSON.parse(state.get(buildVideoSeamDraftStorageKey(userId)) || '{}') as Record<string, unknown>
}

function startButton(renderer: RenderResult): HTMLButtonElement {
  const button = renderer.container.querySelector('button.glass-btn-primary')
  if (!(button instanceof HTMLButtonElement)) throw new Error('start button not found')
  return button
}

describe('video tools page', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    pageMocks.apiFetch.mockReset()
    pageMocks.routerPush.mockReset()
    pageMocks.session.data = { user: { id: 'user-1' } }
    pageMocks.session.status = 'authenticated'
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders the current result without any recent-concatenation history controls', () => {
    const html = renderToStaticMarkup(createElement(VideoToolsPage))

    expect(html).toContain('result.title')
    expect(html).not.toContain('history.title')
    expect(html).not.toContain('actions.refresh')
  })

  it('renders free voice as a video-tools level tool', () => {
    const html = renderToStaticMarkup(createElement(VideoToolsPage))

    expect(html).toContain('data-free-voice-tool')
    expect(html).toContain('freeVoice.title')
  })

  it('keeps result download on the native video controls only', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain('controls preload="metadata"')
    expect(source).not.toContain("t('actions.download')")
  })

  it('keeps direct mode as the default and renders only validated AI diagnostics', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain("useState<'direct' | 'ai_bridge'>('direct')")
    expect(source).toContain('useState<4 | 6 | 8>(4)')
    expect(source).toContain('resolveVideoSeamDiagnostics(currentTask?.result || null)')
    expect(source).toContain('<VideoSeamDiagnostics diagnostics={diagnostics}')
  })

  it('selects truthful workflow copy for the active seam mode', () => {
    const source = readFileSync('src/app/[locale]/workspace/video-tools/page.tsx', 'utf8')

    expect(source).toContain("seamMode === 'ai_bridge' ? t('workflowNoteAi') : t('workflowNoteDirect')")
    expect(source).not.toContain("{t('workflowNote')}")
  })

  it('hydrates before persisting, immediately refetches, blocks duplicate submit, and polls without overlap', async () => {
    const key = buildVideoSeamDraftStorageKey('user-1')
    const { localStorage } = installBrowserStorage([[key, storedValue('user-1', storedDraft)]])
    const firstMountRequest = deferred<Response>()
    pageMocks.apiFetch.mockImplementation(() => firstMountRequest.promise)

    const firstMount = await mountPage()
    expect(pageMocks.apiFetch).toHaveBeenCalledTimes(1)
    firstMount.unmount()

    pageMocks.apiFetch.mockReset()
    localStorage.setItem.mockClear()
    const recoveredRequest = deferred<Response>()
    const pollingRequest = deferred<Response>()
    pageMocks.apiFetch
      .mockImplementationOnce(() => recoveredRequest.promise)
      .mockImplementationOnce(() => pollingRequest.promise)

    const renderer = await mountPage()

    expect(pageMocks.apiFetch).toHaveBeenCalledTimes(1)
    expect(renderer.container.querySelectorAll('[data-upload-name="one.mp4"]')).toHaveLength(1)
    expect(renderer.container.querySelectorAll('[data-trim-frames="3"]')).toHaveLength(1)
    expect(startButton(renderer).disabled).toBe(true)
    startButton(renderer).click()
    expect(pageMocks.apiFetch).toHaveBeenCalledTimes(1)
    expect(localStorage.setItem.mock.calls.every(([, raw]) => JSON.parse(raw).input1?.name === 'one.mp4')).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(pageMocks.apiFetch).toHaveBeenCalledTimes(1)

    await resolveRequest(recoveredRequest, Response.json({
      id: 'task-1',
      status: 'processing',
      progress: 30,
      payload: { stage: 'generate_bridge' },
      result: null,
      error: null,
    }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(pageMocks.apiFetch).toHaveBeenCalledTimes(2)

    renderer.unmount()
  })

  it('clears a stale recovered task on 404 while preserving the uploaded form draft', async () => {
    const key = buildVideoSeamDraftStorageKey('user-1')
    const { state } = installBrowserStorage([[key, storedValue('user-1', storedDraft)]])
    pageMocks.apiFetch.mockResolvedValue(new Response('{}', { status: 404 }))

    const renderer = await mountPage()

    expect(readPersistedDraft(state).taskId).toBeNull()
    expect(readPersistedDraft(state).input1).toMatchObject({ name: 'one.mp4' })
    expect(startButton(renderer).disabled).toBe(false)
    renderer.unmount()
  })

  it.each([
    ['network', () => Promise.reject(new TypeError('offline'))],
    ['server', () => Promise.resolve(new Response('{}', { status: 503 }))],
  ])('keeps a recovered placeholder active after a transient %s failure', async (_kind, request) => {
    const key = buildVideoSeamDraftStorageKey('user-1')
    const { state } = installBrowserStorage([[key, storedValue('user-1', storedDraft)]])
    pageMocks.apiFetch.mockImplementation(request)

    const renderer = await mountPage()

    expect(readPersistedDraft(state).taskId).toBe('task-1')
    expect(startButton(renderer).disabled).toBe(true)
    renderer.unmount()
  })

  it.each([
    ['completed', {
      id: 'task-1',
      status: 'completed',
      progress: 100,
      payload: null,
      result: { videoKey: 'output.mp4', videoUrl: '/output.mp4' },
      error: null,
    }],
    ['failed', {
      id: 'task-1',
      status: 'failed',
      progress: 30,
      payload: null,
      result: null,
      error: { message: 'VIDEO_SEAM_CONCAT_FAILED' },
    }],
  ])('keeps a recovered %s result visible but removes its persisted task id', async (status, task) => {
    const key = buildVideoSeamDraftStorageKey('user-1')
    const { state } = installBrowserStorage([[key, storedValue('user-1', storedDraft)]])
    pageMocks.apiFetch.mockResolvedValue(Response.json(task))

    const renderer = await mountPage()

    expect(renderer.container.textContent).toContain(`status.${status}`)
    expect(readPersistedDraft(state).taskId).toBeNull()
    renderer.unmount()
  })

  it('aborts the StrictMode duplicate request and ignores its late response after terminal state', async () => {
    const key = buildVideoSeamDraftStorageKey('user-1')
    const { state } = installBrowserStorage([[key, storedValue('user-1', storedDraft)]])
    const requests: Array<{ request: Deferred<Response>; signal?: AbortSignal }> = []
    pageMocks.apiFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const request = deferred<Response>()
      requests.push({ request, signal: init?.signal || undefined })
      return request.promise
    })

    const renderer = await mountPage(true)

    expect(requests).toHaveLength(2)
    expect(requests[0].signal?.aborted).toBe(true)
    expect(requests[1].signal?.aborted).toBe(false)

    await resolveRequest(requests[1].request, Response.json({
      id: 'task-1',
      status: 'completed',
      progress: 100,
      payload: null,
      result: { videoKey: 'output.mp4', videoUrl: '/output.mp4' },
      error: null,
    }))
    await resolveRequest(requests[0].request, Response.json({
      id: 'task-1',
      status: 'processing',
      progress: 10,
      payload: { stage: 'probe_media' },
      result: null,
      error: null,
    }))

    expect(renderer.container.textContent).toContain('status.completed')
    expect(readPersistedDraft(state).taskId).toBeNull()
    renderer.unmount()
  })

  it('isolates a user switch and aborts the previous user task request', async () => {
    const user1Key = buildVideoSeamDraftStorageKey('user-1')
    const user2Key = buildVideoSeamDraftStorageKey('user-2')
    const user2Draft = {
      ...storedDraft,
      input1: { ...storedDraft.input1!, name: 'user-two.mp4' },
      taskId: null,
    }
    const { state } = installBrowserStorage([
      [user1Key, storedValue('user-1', storedDraft)],
      [user2Key, storedValue('user-2', user2Draft)],
    ])
    const user1Request = deferred<Response>()
    let user1Signal: AbortSignal | undefined
    pageMocks.apiFetch.mockImplementation((_url: string, init?: RequestInit) => {
      user1Signal = init?.signal || undefined
      return user1Request.promise
    })
    const renderer = await mountPage()

    pageMocks.session.data = { user: { id: 'user-2' } }
    await act(async () => {
      renderer.rerender(createElement(VideoToolsPage))
      await Promise.resolve()
    })

    expect(user1Signal?.aborted).toBe(true)
    await rejectRequest(user1Request, new TypeError('late user-1 failure'))
    expect(renderer.container.querySelectorAll('[data-upload-name="user-two.mp4"]')).toHaveLength(1)
    expect(renderer.container.textContent).not.toContain('late user-1 failure')
    expect(readPersistedDraft(state, 'user-1').input1).toMatchObject({ name: 'one.mp4' })
    expect(readPersistedDraft(state, 'user-2').input1).toMatchObject({ name: 'user-two.mp4' })
    renderer.unmount()
  })
})
