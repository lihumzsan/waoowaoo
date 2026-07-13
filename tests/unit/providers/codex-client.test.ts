import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
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
  CodexExecError,
  resolveCodexExecutablePath,
  runCodexImageGeneration,
  runCodexSelfCheck,
  runCodexTextCompletion,
} from '@/lib/providers/codex/client'

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

  it('expands Windows environment variables in explicit custom paths', () => {
    const previous = process.env.USERPROFILE
    process.env.USERPROFILE = 'C:\\Users\\Unit'
    try {
      expect(resolveCodexExecutablePath('%USERPROFILE%\\tools\\codex.exe'))
        .toBe('C:\\Users\\Unit\\tools\\codex.exe')
    } finally {
      if (previous === undefined) {
        delete process.env.USERPROFILE
      } else {
        process.env.USERPROFILE = previous
      }
    }
  })

  it('uses the current Codex CLI path when configured with the legacy sandbox default', () => {
    const previousCliPath = process.env.CODEX_CLI_PATH
    const previousUserProfile = process.env.USERPROFILE
    process.env.CODEX_CLI_PATH = process.execPath
    process.env.USERPROFILE = 'C:\\Users\\Unit'
    try {
      expect(resolveCodexExecutablePath('%USERPROFILE%\\.codex\\.sandbox-bin\\codex.exe'))
        .toBe(process.execPath)
    } finally {
      if (previousCliPath === undefined) {
        delete process.env.CODEX_CLI_PATH
      } else {
        process.env.CODEX_CLI_PATH = previousCliPath
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE
      } else {
        process.env.USERPROFILE = previousUserProfile
      }
    }
  })

  it('builds the read-only codex exec command', () => {
    const args = buildCodexExecArgs({
      outputPath: 'C:\\tmp\\out.txt',
      imagePaths: ['C:\\tmp\\image.png'],
    })

    expect(args).toEqual([
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
      'C:\\tmp\\out.txt',
      '-i',
      'C:\\tmp\\image.png',
      '-',
    ])
  })

  it('builds the danger-full-access codex exec command for image generation', () => {
    const args = buildCodexImageExecArgs({
      outputPath: 'C:\\tmp\\last-message.json',
      imagePaths: ['C:\\tmp\\ref-1.png', 'C:\\tmp\\ref-2.png'],
    })

    expect(args).toEqual([
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
      '--enable',
      'image_generation',
      '--sandbox',
      'danger-full-access',
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
      'C:\\tmp\\last-message.json',
      '-i',
      'C:\\tmp\\ref-1.png',
      '-i',
      'C:\\tmp\\ref-2.png',
      '-',
    ])
  })

  it('wraps codex output from the final message file', async () => {
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
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
      messages: [{ role: 'user', content: 'say ok' }],
      timeoutMs: 1000,
    })

    expect(result.text).toBe('Codex OK')
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('sends text prompts through stdin instead of the argv prompt slot', async () => {
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
        child.emit('close', 0, null)
      })
      return child
    })

    await runCodexTextCompletion({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello from stdin' }],
      timeoutMs: 1000,
    })

    const args = spawnMock.mock.calls[0]![1] as string[]
    expect(args.at(-1)).toBe('-')
    expect(args).not.toContain('USER:\nhello from stdin')
    expect(stdinPayload).toContain('USER:\nhello from stdin')
  })

  it('runs the lightweight self-check against the local CLI', async () => {
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
      queueMicrotask(async () => {
        const outputPath = args[args.indexOf('--output-last-message') + 1]
        if (!outputPath) throw new Error('missing output path')
        await fs.writeFile(outputPath, 'CODEX_OK\n', 'utf8')
        child.emit('close', 0, null)
      })
      return child
    })

    const result = await runCodexSelfCheck({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      timeoutMs: 1000,
    })

    expect(result.text).toBe('CODEX_OK')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns generated image bytes from a codex image final message path', async () => {
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
      queueMicrotask(async () => {
        const outputPath = args[args.indexOf('--output-last-message') + 1]
        if (!outputPath) throw new Error('missing output path')
        const imagePath = path.join(path.dirname(outputPath), 'generated.png')
        await fs.writeFile(imagePath, pngBytes)
        await fs.writeFile(outputPath, JSON.stringify({ image_path: imagePath }), 'utf8')
        child.stdout.write('{"type":"event"}\n')
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
    expect(result.text).toContain('image_path')
  })

  it('sends image generation prompts through stdin instead of an argv prompt slot', async () => {
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    let stdinPayload = ''
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
      child.stdin.on('data', (chunk) => {
        stdinPayload += chunk.toString('utf8')
      })
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

    await runCodexImageGeneration({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      prompt: 'Generate one image from stdin.',
      timeoutMs: 1000,
    })

    const args = spawnMock.mock.calls[0]![1] as string[]
    expect(args.at(-1)).toBe('-')
    expect(args).not.toContain('Generate one image from stdin.')
    expect(stdinPayload).toContain('Generate one image from stdin.')
  })

  it('returns generated image bytes from a codex stdout event path', async () => {
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-stdout-image-'))
    const externalImagePath = path.join(externalDir, 'generated-from-event.png')

    try {
      spawnMock.mockImplementation((_exe: string, args: string[]) => {
        const child = createMockChild()
        queueMicrotask(async () => {
          const outputPath = args[args.indexOf('--output-last-message') + 1]
          if (!outputPath) throw new Error('missing output path')
          await fs.writeFile(externalImagePath, pngBytes)
          await fs.writeFile(outputPath, 'Generated the image.', 'utf8')
          child.stdout.write(JSON.stringify({ type: 'session.started' }) + '\n')
          child.stdout.write(JSON.stringify({
            type: 'image_generation.completed',
            item: {
              image_path: externalImagePath,
            },
          }) + '\n')
          child.emit('close', 0, null)
        })
        return child
      })

      const result = await runCodexImageGeneration({
        codexPath: process.execPath,
        model: 'gpt-5.5',
        prompt: 'Generate one image.',
        timeoutMs: 1000,
      })

      expect(result.imageBase64).toBe(pngBytes.toString('base64'))
      expect(result.mimeType).toBe('image/png')
      expect(result.imagePath).toBe(externalImagePath)
      expect(result.text).toBe('Generated the image.')
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('does not treat input reference paths from stdout as generated images', async () => {
    const referenceBytes = Buffer.from('ffd8ff0001', 'hex')
    const generatedBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-reference-skip-'))
    const referencePath = path.join(externalDir, 'reference.png')
    const generatedPath = path.join(externalDir, 'generated.png')

    try {
      await fs.writeFile(referencePath, referenceBytes)

      spawnMock.mockImplementation((_exe: string, args: string[]) => {
        const child = createMockChild()
        queueMicrotask(async () => {
          const outputPath = args[args.indexOf('--output-last-message') + 1]
          if (!outputPath) throw new Error('missing output path')
          await fs.writeFile(generatedPath, generatedBytes)
          await fs.writeFile(outputPath, 'Generated the image.', 'utf8')
          child.stdout.write(JSON.stringify({
            type: 'input_image.attached',
            path: referencePath,
          }) + '\n')
          child.stdout.write(JSON.stringify({
            type: 'image_generation.completed',
            image_path: generatedPath,
          }) + '\n')
          child.emit('close', 0, null)
        })
        return child
      })

      const result = await runCodexImageGeneration({
        codexPath: process.execPath,
        model: 'gpt-5.5',
        prompt: 'Generate one image from this reference.',
        imagePaths: [referencePath],
        timeoutMs: 1000,
      })

      expect(result.imagePath).toBe(generatedPath)
      expect(result.imageBase64).toBe(generatedBytes.toString('base64'))
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('throws CODEX_IMAGE_OUTPUT_NOT_FOUND when codex does not report an image', async () => {
    spawnMock.mockImplementation((_exe: string, args: string[]) => {
      const child = createMockChild()
      queueMicrotask(async () => {
        const outputPath = args[args.indexOf('--output-last-message') + 1]
        if (!outputPath) throw new Error('missing output path')
        await fs.writeFile(outputPath, 'No image was generated.', 'utf8')
        child.emit('close', 0, null)
      })
      return child
    })

    await expect(runCodexImageGeneration({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      prompt: 'Generate one image.',
      timeoutMs: 1000,
    })).rejects.toMatchObject({
      code: 'CODEX_IMAGE_OUTPUT_NOT_FOUND',
    } satisfies Partial<CodexExecError>)
  })

  it('throws CODEX_EXEC_FAILED with process output on non-zero exit', async () => {
    spawnMock.mockImplementation(() => {
      const child = createMockChild()
      queueMicrotask(() => {
        child.stdout.write('stdout detail')
        child.stderr.write('stderr detail')
        child.emit('close', 42, null)
      })
      return child
    })

    await expect(runCodexTextCompletion({
      codexPath: process.execPath,
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'fail' }],
      timeoutMs: 1000,
    })).rejects.toMatchObject({
      code: 'CODEX_EXEC_FAILED',
      exitCode: 42,
      stdout: 'stdout detail',
      stderr: 'stderr detail',
    } satisfies Partial<CodexExecError>)
  })

  it('rejects timeout even when the codex child does not close', async () => {
    vi.useFakeTimers()
    try {
      const codexChild = createMockChild()
      spawnMock.mockImplementation((exe: string) => {
        if (exe === 'taskkill') return createMockChild()
        return codexChild
      })

      const pending = runCodexTextCompletion({
        codexPath: process.execPath,
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'hang' }],
        timeoutMs: 100,
      })

      await vi.waitFor(() => {
        expect(spawnMock).toHaveBeenCalled()
      })
      await vi.advanceTimersByTimeAsync(6100)
      await expect(pending).rejects.toMatchObject({
        code: 'CODEX_EXEC_TIMEOUT',
      } satisfies Partial<CodexExecError>)
      expect(codexChild.kill).toHaveBeenCalledWith('SIGTERM')
    } finally {
      vi.useRealTimers()
    }
  })
})
