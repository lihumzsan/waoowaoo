import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import {
  buildCodexExecArgs,
  CodexExecError,
  resolveCodexExecutablePath,
  runCodexSelfCheck,
  runCodexTextCompletion,
} from '@/lib/providers/codex/client'

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

describe('codex cli client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expands the default Windows user profile path', () => {
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

  it('builds the read-only codex exec command', () => {
    const args = buildCodexExecArgs({
      model: 'gpt-5.4',
      outputPath: 'C:\\tmp\\out.txt',
      prompt: 'USER:\nhello',
      imagePaths: ['C:\\tmp\\image.png'],
    })

    expect(args).toEqual([
      'exec',
      '--ephemeral',
      '--json',
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
      'gpt-5.4',
      '--output-last-message',
      'C:\\tmp\\out.txt',
      '-i',
      'C:\\tmp\\image.png',
      'USER:\nhello',
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
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'say ok' }],
      timeoutMs: 1000,
    })

    expect(result.text).toBe('Codex OK')
    expect(spawnMock).toHaveBeenCalledTimes(1)
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
      model: 'gpt-5.4',
      timeoutMs: 1000,
    })

    expect(result.text).toBe('CODEX_OK')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
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
      model: 'gpt-5.4',
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
        model: 'gpt-5.4',
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
