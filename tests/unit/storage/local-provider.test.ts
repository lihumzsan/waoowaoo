import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalStorageProvider } from '@/lib/storage/providers/local'

function streamBytes(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listDirectory(directory: string): Promise<string[]> {
  try {
    return await fs.readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function waitForTempFile(directory: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if ((await listDirectory(directory)).some((name) => name.endsWith('.tmp'))) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('temporary upload file was not created')
}

describe('local storage provider stream writes', () => {
  const originalUploadDir = process.env.UPLOAD_DIR
  let sandboxRoot = ''
  let uploadRoot = ''
  let provider: LocalStorageProvider

  beforeEach(async () => {
    sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-local-storage-'))
    uploadRoot = path.join(sandboxRoot, 'uploads')
    process.env.UPLOAD_DIR = path.relative(process.cwd(), uploadRoot)
    vi.resetModules()
    const { LocalStorageProvider: Provider } = await import('@/lib/storage/providers/local')
    provider = new Provider()
  })

  afterEach(async () => {
    vi.resetModules()
    if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR
    else process.env.UPLOAD_DIR = originalUploadDir
    await fs.rm(sandboxRoot, { recursive: true, force: true })
  })

  it('rejects traversal keys for buffer writes', async () => {
    const escapedPath = path.join(sandboxRoot, 'escaped-buffer.mp4')

    await expect(provider.uploadObject({
      key: '../escaped-buffer.mp4',
      body: Buffer.from([1]),
      contentType: 'video/mp4',
    })).rejects.toThrow('STORAGE_KEY_INVALID')

    expect(await pathExists(escapedPath)).toBe(false)
  })

  it('rejects traversal keys for stream writes', async () => {
    const escapedPath = path.join(sandboxRoot, 'escaped-stream.mp4')

    await expect(provider.uploadObjectStream({
      key: '../escaped-stream.mp4',
      body: streamBytes([1]),
      contentLength: 1,
      contentType: 'video/mp4',
    })).rejects.toThrow('STORAGE_KEY_INVALID')

    expect(await pathExists(escapedPath)).toBe(false)
  })

  it('removes the temporary file when the stream is shorter than contentLength', async () => {
    const key = 'video-tools/user-1/inputs/truncated.mp4'
    const finalPath = path.join(uploadRoot, key)

    await expect(provider.uploadObjectStream({
      key,
      body: streamBytes([1, 2]),
      contentLength: 3,
      contentType: 'video/mp4',
    })).rejects.toThrow('STORAGE_STREAM_LENGTH_MISMATCH')

    expect(await pathExists(finalPath)).toBe(false)
    expect(await listDirectory(path.dirname(finalPath))).toEqual([])
  })

  it('removes the temporary file when the source stream errors', async () => {
    const key = 'video-tools/user-1/inputs/source-error.mp4'
    const finalPath = path.join(uploadRoot, key)
    const sourceError = new Error('source stream failed')
    let pullCount = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1
          controller.enqueue(new Uint8Array([1]))
          return
        }
        controller.error(sourceError)
      },
    })

    await expect(provider.uploadObjectStream({
      key,
      body,
      contentLength: 3,
      contentType: 'video/mp4',
    })).rejects.toThrow(sourceError)

    expect(await pathExists(finalPath)).toBe(false)
    expect(await listDirectory(path.dirname(finalPath))).toEqual([])
  })

  it('removes the temporary file when the atomic destination commit fails', async () => {
    const key = 'video-tools/user-1/inputs/commit-failure.mp4'
    const finalPath = path.join(uploadRoot, key)
    await fs.mkdir(finalPath, { recursive: true })

    await expect(provider.uploadObjectStream({
      key,
      body: streamBytes([1, 2, 3]),
      contentLength: 3,
      contentType: 'video/mp4',
    })).rejects.toThrow()

    expect((await fs.stat(finalPath)).isDirectory()).toBe(true)
    expect(await listDirectory(path.dirname(finalPath))).toEqual(['commit-failure.mp4'])
  })

  it('keeps the final path absent until an exact stream is atomically renamed', async () => {
    const key = 'video-tools/user-1/inputs/success.mp4'
    const finalPath = path.join(uploadRoot, key)
    const sourceState: { controller?: ReadableStreamDefaultController<Uint8Array> } = {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceState.controller = controller
        controller.enqueue(new Uint8Array([1]))
      },
    })

    const uploadPromise = provider.uploadObjectStream({
      key,
      body,
      contentLength: 3,
      contentType: 'video/mp4',
    })
    await waitForTempFile(path.dirname(finalPath))

    expect(await pathExists(finalPath)).toBe(false)
    sourceState.controller?.enqueue(new Uint8Array([2, 3]))
    sourceState.controller?.close()

    await expect(uploadPromise).resolves.toEqual({ key })
    expect(Array.from(await fs.readFile(finalPath))).toEqual([1, 2, 3])
    expect(await listDirectory(path.dirname(finalPath))).toEqual(['success.mp4'])
  })
})
