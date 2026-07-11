import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const readWorkspaceFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('uploaded voice entry points', () => {
  test('continue directly without the IndexTTS/QwenTTS compatibility prompt', () => {
    const projectVoiceSettings = readWorkspaceFile(
      'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings.tsx',
    )
    const speakerBindingDialog = readWorkspaceFile(
      'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog.tsx',
    )
    const localeResources = [
      'messages/zh/assets.json',
      'messages/en/assets.json',
      'messages/zh/voice.json',
      'messages/en/voice.json',
    ].map(readWorkspaceFile)

    expect(projectVoiceSettings).not.toContain('uploadQwenHint')
    expect(projectVoiceSettings).not.toContain('window.confirm')
    expect(projectVoiceSettings).toContain(
      'onClick={() => voiceFileInputRef.current?.click()}',
    )

    expect(speakerBindingDialog).not.toContain('uploadQwenHint')
    expect(speakerBindingDialog).not.toContain('window.confirm')
    expect(speakerBindingDialog).toContain(
      'onClick={() => setSubDialogOpen(true)}',
    )

    for (const resource of localeResources) {
      expect(resource).not.toContain('uploadQwenHint')
      expect(resource).not.toContain(
        'Uploaded voices can only be synthesized with IndexTTS',
      )
      expect(resource).not.toContain('上传的音色后续只可使用 IndexTTS 合成')
    }
  })
})
