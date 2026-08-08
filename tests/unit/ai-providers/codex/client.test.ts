import { describe, expect, it } from 'vitest'
import {
  buildCodexImageExecArgs,
  buildCodexPrompt,
} from '@/lib/ai-providers/codex/client'

describe('Codex image client', () => {
  it('builds an image-generation exec command with references and a JSON output file', () => {
    const args = buildCodexImageExecArgs({
      model: 'gpt-image-2',
      outputPath: 'C:/tmp/last-message.json',
      imagePaths: ['C:/tmp/reference.png'],
    })

    expect(args).toEqual(expect.arrayContaining([
      'exec',
      '--enable',
      'image_generation',
      '-m',
      'gpt-image-2',
      '--output-last-message',
      'C:/tmp/last-message.json',
      '-i',
      'C:/tmp/reference.png',
    ]))
    expect(args.at(-1)).toBe('-')
  })

  it('serializes role-labelled text prompts for the Codex CLI', () => {
    expect(buildCodexPrompt([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Draw a red kite.' },
    ])).toBe('SYSTEM:\nBe concise.\n\nUSER:\nDraw a red kite.')
  })
})
