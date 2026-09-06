import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkLocalProviderBoundary } from '../../scripts/check-local-provider-boundary.mjs'

const temporaryRoots: string[] = []

function createFixture(files: Record<string, string>): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'wao-local-provider-'))
  temporaryRoots.push(rootDir)
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(rootDir, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  return rootDir
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const rootDir = temporaryRoots.pop()
    if (rootDir) rmSync(rootDir, { recursive: true, force: true })
  }
})

describe('local provider boundary', () => {
  it('rejects external provider and cloud settings from active acceptance surfaces', () => {
    const rootDir = createFixture({
      '.env.example': [
        'DEPLOYMENT_EDITION=cloud',
        'OPENAI_API_KEY=secret',
        'PLATFORM_NEWPROVIDER_API_KEY=secret',
        'PLATFORM_DEFAULT_VIDEO_MODEL=newprovider::video',
      ].join('\n'),
      '.env.cloud.example': '',
      '.github/workflows/verify.yml': 'PLATFORM_DEFAULT_ANALYSIS_MODEL: openrouter::model',
    })

    const result = checkLocalProviderBoundary({ rootDir })

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.stringContaining('cloud example'),
      expect.stringContaining('cloud deployment'),
      expect.stringContaining('external OpenAI API'),
      expect.stringContaining('external provider model'),
      expect.stringContaining('external provider credential'),
      expect.stringContaining('routed text model'),
    ]))
  })

  it('accepts the Codex and ComfyUI local provider configuration', () => {
    const rootDir = createFixture({
      '.env.example': [
        'DEPLOYMENT_EDITION=self-hosted',
        'PROVIDER_CREDENTIAL_MODE=user-key',
        'PLATFORM_DEFAULT_CHARACTER_MODEL=codex::gpt-image-2',
        'PLATFORM_DEFAULT_VIDEO_MODEL=comfyui::minimax-h3-dual-stage-2mp',
        'PLATFORM_DEFAULT_MUSIC_MODEL=comfyui::ace-step-1.5',
        'PLATFORM_DEFAULT_SOUND_MODEL=comfyui::moss-soundeffect-v2',
      ].join('\n'),
      '.github/workflows/verify.yml': [
        'PLATFORM_DEFAULT_CHARACTER_MODEL: codex::gpt-image-2',
        'PLATFORM_DEFAULT_VIDEO_MODEL: comfyui::minimax-h3-dual-stage-2mp',
      ].join('\n'),
    })

    expect(checkLocalProviderBoundary({ rootDir }).violations).toEqual([])
  })
})
