import { describe, expect, it } from 'vitest'
import { createAudioGenerator, createImageGenerator, createVideoGenerator } from '@/lib/generators/factory'
import { GoogleVeoVideoGenerator } from '@/lib/generators/video/google'
import { BailianAudioGenerator, BailianImageGenerator, BailianVideoGenerator, SiliconFlowAudioGenerator } from '@/lib/generators/official'
import { CodexImageGenerator } from '@/lib/generators/image/codex'

describe('generator factory', () => {
  it('routes gemini-compatible video provider to Google video generator', () => {
    const generator = createVideoGenerator('gemini-compatible:gm-1')
    expect(generator).toBeInstanceOf(GoogleVeoVideoGenerator)
  })

  it('routes bailian official providers to official generators', () => {
    expect(createImageGenerator('bailian')).toBeInstanceOf(BailianImageGenerator)
    expect(createVideoGenerator('bailian')).toBeInstanceOf(BailianVideoGenerator)
    expect(createAudioGenerator('bailian')).toBeInstanceOf(BailianAudioGenerator)
  })

  it('routes siliconflow audio provider to official generator', () => {
    expect(createAudioGenerator('siliconflow')).toBeInstanceOf(SiliconFlowAudioGenerator)
  })

  it('routes codex image provider to codex image generator', () => {
    expect(createImageGenerator('codex', 'gpt-image-2')).toBeInstanceOf(CodexImageGenerator)
  })
})
