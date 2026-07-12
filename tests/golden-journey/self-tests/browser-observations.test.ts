import { describe, expect, it } from 'vitest'
import { collectGoldenBrowserObservationViolations } from '../browser/observations'

describe('Golden browser observation allowances', () => {
  it('allows only the declared failed method and keeps same-URL GET plus unrelated failures visible', () => {
    const violations = collectGoldenBrowserObservationViolations({
      consoleErrors: [
        { type: 'error', text: '创建项目失败: expected response loss', location: 'app:1:1' },
        { type: 'error', text: 'unexpected render failure', location: 'app:2:1' },
      ],
      pageErrors: [{ name: 'Error', message: 'render crashed', stack: null }],
      failedRequests: [
        { method: 'POST', url: 'http://127.0.0.1/api/projects', status: null, failure: 'net::ERR_FAILED' },
        { method: 'GET', url: 'http://127.0.0.1/api/projects', status: null, failure: 'net::ERR_FAILED' },
      ],
      errorResponses: [
        { method: 'GET', url: 'http://127.0.0.1/api/projects', status: 403, failure: null },
        { method: 'GET', url: 'http://127.0.0.1/api/deployment', status: 500, failure: null },
      ],
      blockedExternalRequests: [],
    }, {
      allowedConsoleErrorPatterns: [/创建项目失败/],
      allowedFailedRequestPatterns: [{ method: 'POST', url: /\/api\/projects$/ }],
      allowedHttpStatuses: new Set([403]),
    })

    expect(violations).toEqual([
      'console:unexpected render failure',
      'page:Error:render crashed',
      'request:GET:http://127.0.0.1/api/projects:net::ERR_FAILED',
      'response:500:GET:http://127.0.0.1/api/deployment',
    ])
  })
})
