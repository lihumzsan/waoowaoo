import { describe, expect, test, vi } from 'vitest'

import {
  assertWarmupEnvironment,
  mergeResponseCookies,
  runDevWarmup,
} from '../../../scripts/dev-warmup'

describe('assertWarmupEnvironment', () => {
  test('rejects non-local targets', () => {
    expect(() => assertWarmupEnvironment('https://example.com', 'development'))
      .toThrow('local')
  })

  test('rejects production mode', () => {
    expect(() => assertWarmupEnvironment('http://127.0.0.1:3000', 'production'))
      .toThrow('production')
  })
})

describe('mergeResponseCookies', () => {
  test('keeps the newest value for each cookie name', () => {
    const cookies = new Map<string, string>([
      ['next-auth.csrf-token', 'old'],
    ])
    const response = new Response(null, {
      headers: {
        'set-cookie': 'next-auth.csrf-token=new; Path=/; HttpOnly',
      },
    })

    const result = mergeResponseCookies(cookies, response)

    expect(result.get('next-auth.csrf-token')).toBe('new')
  })
})

describe('runDevWarmup', () => {
  test('retries startup, signs in, and warms authenticated routes with cookies', async () => {
    const calls: Array<{ path: string; cookie: string; body: string }> = []
    const logs: string[] = []
    let landingAttempts = 0

    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const headers = new Headers(init?.headers)
      const body = typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : ''
      calls.push({
        path: `${url.pathname}${url.search}`,
        cookie: headers.get('cookie') || '',
        body,
      })

      if (url.pathname === '/zh') {
        landingAttempts += 1
        if (landingAttempts === 1) throw new TypeError('connection refused')
        return new Response('ok', { status: 200 })
      }

      if (url.pathname === '/api/auth/csrf') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-secret' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'next-auth.csrf-token=csrf-cookie; Path=/; HttpOnly',
          },
        })
      }

      if (url.pathname === '/api/auth/callback/credentials') {
        expect(headers.get('cookie')).toContain('next-auth.csrf-token=csrf-cookie')
        expect(body).toContain('username=tigli')
        expect(body).toContain('password=123456')
        expect(body).toContain('csrfToken=csrf-secret')
        return new Response(JSON.stringify({ url: 'http://127.0.0.1:3000/zh/home' }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'next-auth.session-token=session-secret; Path=/; HttpOnly',
          },
        })
      }

      if (url.pathname === '/api/projects') {
        return new Response(JSON.stringify({
          projects: [
            { id: 'project-other', name: 'mountain' },
            { id: 'project-gu', name: '蛊真人后传' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url.pathname === '/api/projects/project-gu/data') {
        return new Response(JSON.stringify({
          project: {
            novelPromotionData: {
              episodes: [
                { id: 'episode-1', name: '第1集' },
                { id: 'episode-2', name: '第2集' },
              ],
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const results = await runDevWarmup({
      baseUrl: 'http://127.0.0.1:3000',
      username: 'tigli',
      password: '123456',
      nodeEnv: 'development',
      fetchImpl,
      sleep: async () => undefined,
      startupTimeoutMs: 1_000,
      requestTimeoutMs: 1_000,
      log: (message) => logs.push(message),
    })

    expect(calls.map((call) => call.path)).toEqual([
      '/zh',
      '/zh',
      '/api/auth/csrf',
      '/api/auth/callback/credentials',
      '/api/auth/session',
      '/zh/home',
      '/api/projects?page=1&pageSize=5',
      '/zh/workspace/project-gu',
      '/api/projects/project-gu/data',
      '/zh/workspace/project-gu?episode=episode-1',
      '/api/novel-promotion/project-gu/episodes/episode-1?profile=config',
      '/api/runs?projectId=project-gu&workflowType=story_to_script_run&targetType=NovelPromotionEpisode&targetId=episode-1&episodeId=episode-1&limit=20&status=queued&status=running&status=canceling&_v=2',
    ])
    for (const call of calls.slice(4)) {
      expect(call.cookie).toContain('next-auth.session-token=session-secret')
    }
    expect(results.map((result) => result.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200,
    ])
    expect(logs.join('\n')).not.toContain('123456')
    expect(logs.join('\n')).not.toContain('csrf-secret')
    expect(logs.join('\n')).not.toContain('session-secret')
    expect(logs.at(-1)).toBe('=========项目启动成功===========')
  })

  test('returns cleanly and skips authenticated routes when csrf fails', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      calls.push(url.pathname)
      if (url.pathname === '/zh') return new Response('ok', { status: 200 })
      return new Response('unavailable', { status: 503 })
    })

    const results = await runDevWarmup({
      baseUrl: 'http://localhost:3000',
      username: 'tigli',
      password: '123456',
      nodeEnv: 'development',
      fetchImpl,
      sleep: async () => undefined,
      startupTimeoutMs: 1_000,
      requestTimeoutMs: 1_000,
      log: () => undefined,
    })

    expect(calls).toEqual(['/zh', '/api/auth/csrf'])
    expect(results).toHaveLength(2)
    expect(results[0]?.status).toBe(200)
    expect(results[1]?.status).toBe(503)
  })
})
