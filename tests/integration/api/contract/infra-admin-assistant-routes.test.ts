import {
  NextRequest,
  ROUTE_CATALOG,
  afterEach,
  authState,
  beforeEach,
  buildMockRequest,
  describe,
  expect,
  fs,
  it,
  loggingMock,
  path,
  vi,
} from './infra-routes.fixture'

describe('api contract - infra routes (behavior)', () => {
  const routes = ROUTE_CATALOG.filter((entry) => entry.contractGroup === 'infra-routes')

  const originalUploadDir = process.env.UPLOAD_DIR

  const tempState = {
    uploadDirAbs: '',
    uploadDirRel: '',
  }

  const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION

  const originalProviderCredentialMode = process.env.PROVIDER_CREDENTIAL_MODE

  const originalBillingMode = process.env.BILLING_MODE

  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = false
    vi.resetModules()
  })

  afterEach(async () => {
    vi.resetModules()
    if (tempState.uploadDirAbs) {
      await fs.rm(tempState.uploadDirAbs, { recursive: true, force: true })
      tempState.uploadDirAbs = ''
      tempState.uploadDirRel = ''
    }
    if (originalUploadDir === undefined) {
      delete process.env.UPLOAD_DIR
    } else {
      process.env.UPLOAD_DIR = originalUploadDir
    }
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalProviderCredentialMode === undefined) {
      delete process.env.PROVIDER_CREDENTIAL_MODE
    } else {
      process.env.PROVIDER_CREDENTIAL_MODE = originalProviderCredentialMode
    }
    if (originalBillingMode === undefined) {
      delete process.env.BILLING_MODE
    } else {
      process.env.BILLING_MODE = originalBillingMode
    }
  })

  function buildTextAttachmentRequest(file: File): NextRequest {
    const form = new FormData()
    form.set('file', file)
    return new NextRequest(new URL('/api/assistant/text-attachments', 'http://localhost:3000'), {
      method: 'POST',
      body: form,
    })
  }

  it('infra route group exists', () => {
    expect(routes.map((entry) => entry.routeFile)).toEqual(expect.arrayContaining([
      'src/app/api/admin/download-logs/route.ts',
      'src/app/api/assistant/text-attachments/route.ts',
      'src/app/api/cos/image/route.ts',
      'src/app/api/files/[...path]/route.ts',
      'src/app/api/storage/sign/route.ts',
      'src/app/api/system/boot-id/route.ts',
    ]))
  })

  it('GET /api/admin/download-logs rejects unauthenticated requests', async () => {
    const mod = await import('@/app/api/admin/download-logs/route')
    const req = buildMockRequest({
      path: '/api/admin/download-logs',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
    expect(loggingMock.readAllLogs).not.toHaveBeenCalled()
  })

  it('GET /api/admin/download-logs returns attachment headers when authenticated', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/admin/download-logs/route')
    const req = buildMockRequest({
      path: '/api/admin/download-logs',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('worker log line 1')
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="waoowaoo-logs-/)
  })

  it('POST /api/assistant/text-attachments rejects unauthenticated requests', async () => {
    const mod = await import('@/app/api/assistant/text-attachments/route')
    const req = buildTextAttachmentRequest(new File(['hello'], 'story.txt', { type: 'text/plain' }))

    const res = await mod.POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
  })

  it('POST /api/assistant/text-attachments parses uploaded txt into a structured attachment', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/assistant/text-attachments/route')
    const req = buildTextAttachmentRequest(new File(['  hello\r\nworld  '], 'story.txt', { type: 'text/plain' }))

    const res = await mod.POST(req, { params: Promise.resolve({}) })
    const payload = await res.json() as {
      attachment: {
        id: string
        kind: string
        fileName: string
        mimeType: string
        sizeBytes: number
        checksum: string
        charCount: number
        normalizedText: string
      }
    }

    expect(res.status).toBe(200)
    expect(payload.attachment).toMatchObject({
      kind: 'txt',
      fileName: 'story.txt',
      mimeType: 'text/plain',
      charCount: 11,
      normalizedText: 'hello\nworld',
    })
    expect(payload.attachment.id).toMatch(/^text-attachment:/)
    expect(payload.attachment.sizeBytes).toBeGreaterThan(0)
    expect(payload.attachment.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('GET /api/deployment exposes cloud mode before signup without requiring authentication', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'

    const mod = await import('@/app/api/deployment/route')
    const req = buildMockRequest({
      path: '/api/deployment',
      method: 'GET',
    })
    const res = await mod.GET(req, { params: Promise.resolve({}) })
    const json = await res.json() as {
      success: boolean
      deployment: {
        edition: string
        providerCredentialMode: string
        isCloud: boolean
        usesPlatformProviderKeys: boolean
      }
      features: {
        showOfficialPublicPages: boolean
        showPricingPage: boolean
        showLegalPages: boolean
        showRecharge: boolean
        showInviteCode: boolean
        showBilling: boolean
        showApiConfig: boolean
        showAccountSecurity: boolean
        showGoogleOAuth: boolean
        showDownloadLogs: boolean
        showUpdateCheck: boolean
        requireInviteCodeOnSignup: boolean
        usePlatformProviderConfig: boolean
      }
      billingMode: string
    }

    expect(res.status).toBe(200)
    expect(json).toEqual({
      success: true,
      deployment: {
        edition: 'cloud',
        providerCredentialMode: 'platform-key',
        isCloud: true,
        usesPlatformProviderKeys: true,
      },
      features: {
        showOfficialPublicPages: true,
        showPricingPage: true,
        showLegalPages: true,
        showRecharge: true,
        showInviteCode: true,
        showBilling: true,
        showApiConfig: false,
        showAccountSecurity: true,
        showGoogleOAuth: true,
        showDownloadLogs: false,
        showUpdateCheck: false,
        requireInviteCodeOnSignup: false,
        usePlatformProviderConfig: true,
      },
      billingMode: 'ENFORCE',
    })
  })
})
