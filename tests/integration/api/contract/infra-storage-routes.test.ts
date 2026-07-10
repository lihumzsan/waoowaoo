import {
  afterEach,
  authState,
  beforeEach,
  buildMockRequest,
  describe,
  expect,
  fs,
  it,
  path,
  storageMock,
  vi,
} from './infra-routes.fixture'

describe('api contract - infra routes (behavior)', () => {

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

  async function prepareUploadDir(): Promise<void> {
    const unique = `test-uploads-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    tempState.uploadDirRel = path.join('.tmp', unique)
    tempState.uploadDirAbs = path.join(process.cwd(), tempState.uploadDirRel)
    process.env.UPLOAD_DIR = tempState.uploadDirRel
    await fs.mkdir(tempState.uploadDirAbs, { recursive: true })
  }

  it('GET /api/cos/image redirects to signed storage route with normalized query', async () => {
    const mod = await import('@/app/api/cos/image/route')
    const req = buildMockRequest({
      path: '/api/cos/image?key=folder/a.png&expires=7200',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/api/storage/sign?key=folder%2Fa.png&expires=7200')
  })

  it('GET /api/storage/sign rejects unauthenticated requests', async () => {
    const mod = await import('@/app/api/storage/sign/route')
    const req = buildMockRequest({
      path: '/api/storage/sign?key=folder/a.png',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(401)
    expect(storageMock.getSignedObjectUrl).not.toHaveBeenCalled()
  })

  it('GET /api/storage/sign redirects to signed object url with default ttl when authenticated', async () => {
    authState.authenticated = true
    const mod = await import('@/app/api/storage/sign/route')
    const req = buildMockRequest({
      path: '/api/storage/sign?key=folder/a.png',
      method: 'GET',
    })

    const res = await mod.GET(req, { params: Promise.resolve({}) })

    expect(storageMock.getSignedObjectUrl).toHaveBeenCalledWith('folder/a.png', 3600)
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://signed.example/folder/a.png?expires=3600')
  })

  it('GET /api/system/boot-id returns the current server boot id', async () => {
    const mod = await import('@/app/api/system/boot-id/route')
    const serverBoot = await import('@/lib/server-boot')
    const res = await mod.GET()
    const json = await res.json() as { bootId: string }

    expect(res.status).toBe(200)
    expect(json.bootId).toBe(serverBoot.SERVER_BOOT_ID)
    expect(typeof json.bootId).toBe('string')
    expect(json.bootId.length).toBeGreaterThan(0)
  })

  it('GET /api/files/[...path] rejects path traversal attempts', async () => {
    await prepareUploadDir()
    const mod = await import('@/app/api/files/[...path]/route')
    const req = buildMockRequest({
      path: '/api/files/%2E%2E/secret.txt',
      method: 'GET',
    })

    const res = await mod.GET(req, {
      params: Promise.resolve({ path: ['..', 'secret.txt'] }),
    })
    const json = await res.json() as { error: string }

    expect(res.status).toBe(403)
    expect(json.error).toBe('Access denied')
  })

  it('GET /api/files/[...path] returns 404 when the file is missing', async () => {
    await prepareUploadDir()
    const mod = await import('@/app/api/files/[...path]/route')
    const req = buildMockRequest({
      path: '/api/files/missing.txt',
      method: 'GET',
    })

    const res = await mod.GET(req, {
      params: Promise.resolve({ path: ['missing.txt'] }),
    })
    const json = await res.json() as { error: string }

    expect(res.status).toBe(404)
    expect(json.error).toBe('File not found')
  })

  it('GET /api/files/[...path] serves local files from the configured upload dir', async () => {
    await prepareUploadDir()
    const nestedDir = path.join(tempState.uploadDirAbs, 'folder')
    await fs.mkdir(nestedDir, { recursive: true })
    await fs.writeFile(path.join(nestedDir, 'hello.txt'), 'hello local file', 'utf8')

    const mod = await import('@/app/api/files/[...path]/route')
    const req = buildMockRequest({
      path: '/api/files/folder/hello.txt',
      method: 'GET',
    })

    const res = await mod.GET(req, {
      params: Promise.resolve({ path: ['folder', 'hello.txt'] }),
    })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toBe('hello local file')
    expect(res.headers.get('content-type')).toBe('text/plain')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000')
  })
})
