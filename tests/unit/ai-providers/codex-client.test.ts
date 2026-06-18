import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import {
  buildCodexExecArgs,
  buildCodexImageExecArgs,
  prepareCodexImageInputs,
  resolveCodexExecutablePath,
  runCodexImageGeneration,
  runCodexTextCompletion,
} from '@/lib/ai-providers/codex/client'

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

describe('codex cli client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expands Windows-style environment variables in the executable path', () => {
    const previous = process.env.USERPROFILE
    process.env.USERPROFILE = 'C:\\Users\\Unit'
    try {
      expect(resolveCodexExecutablePath('%USERPROFILE%\\.codex\\.sandbox-bin\\codex.exe'))
        .toBe('C:\\Users\\Unit\\.codex\\.sandbox-bin\\codex.exe')
    } finally {
      if (previous === undefined) {
        delete process.env.USERPROFILE
      } else {
        process.env.USERPROFILE = previous
      }
    }
  })

  it('builds separate read-only and image-generation Codex exec commands', () => {
    expect(buildCodexExecArgs({
      outputPath: '/tmp/out.txt',
      imagePaths: ['/tmp/ref.png'],
    })).toEqual([
      'exec',
      '--ephemeral',
      '--json',
      '--config',
      'approval_policy="never"',
      '--config',
      'model_reasoning_effort="xhigh"',
      '--config',
      'service_tier="fast"',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--disable',
      'plugins',
      '--disable',
      'memories',
      '--disable',
      'apps',
      '--disable',
      'shell_snapshot',
      '-m',
      'gpt-5.5',
      '--output-last-message',
      '/tmp/out.txt',
      '-i',
      '/tmp/ref.png',
      '-',
    ])

    expect(buildCodexImageExecArgs({
      outputPath: '/tmp/image.json',
      imagePaths: ['/tmp/ref.png'],
    })).toContain('--enable')
    expect(buildCodexImageExecArgs({
      outputPath: '/tmp/image.json',
      imagePaths: ['/tmp/ref.png'],
    })).toContain('danger-full-access')
  })

  it('runs text completions through stdin and reads the final message file', async () => {
    let stdinPayload = ''
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
      child.stdin.on('data', (chunk) => {
        stdinPayload += chunk.toString('utf8')
      })
      queueMicrotask(async () => {
        const outputPath = args[args.indexOf('--output-last-message') + 1]
        if (!outputPath) throw new Error('missing output path')
        await fs.writeFile(outputPath, 'Codex OK\n', 'utf8')
        child.stdout.write('{"type":"event"}\n')
        child.emit('close', 0, null)
      })
      return child
    })

    const result = await runCodexTextCompletion({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello from stdin' }],
      timeoutMs: 1000,
    })

    const args = spawnMock.mock.calls[0]![1] as string[]
    expect(args.at(-1)).toBe('-')
    expect(stdinPayload).toContain('USER:\nhello from stdin')
    expect(result.text).toBe('Codex OK')
  })

  it('returns generated image bytes from a Codex final message image path', async () => {
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
      queueMicrotask(async () => {
        const outputPath = args[args.indexOf('--output-last-message') + 1]
        if (!outputPath) throw new Error('missing output path')
        const imagePath = path.join(path.dirname(outputPath), 'generated.png')
        await fs.writeFile(imagePath, pngBytes)
        await fs.writeFile(outputPath, JSON.stringify({ image_path: imagePath }), 'utf8')
        child.emit('close', 0, null)
      })
      return child
    })

    const result = await runCodexImageGeneration({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      prompt: 'Generate one image and report image_path JSON.',
      timeoutMs: 1000,
    })

    expect(result.imageBase64).toBe(pngBytes.toString('base64'))
    expect(result.mimeType).toBe('image/png')
    expect(result.imagePath.endsWith('generated.png')).toBe(true)
  })

  it('prepares reference images from data URLs and normalized remote inputs', async () => {
    const prepared = await prepareCodexImageInputs(
      ['data:image/png;base64,UE5H', 'https://example.test/ref.png'],
      async () => 'data:image/jpeg;base64,/9j/',
    )

    try {
      expect(prepared.imagePaths).toHaveLength(2)
      expect(prepared.imagePaths[0]?.endsWith('.png')).toBe(true)
      expect(prepared.imagePaths[1]?.endsWith('.jpg')).toBe(true)
      expect(await fs.readFile(prepared.imagePaths[0]!, 'utf8')).toBe('PNG')
    } finally {
      await prepared.cleanup()
    }
  })
})
