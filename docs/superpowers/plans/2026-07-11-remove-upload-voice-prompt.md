# Remove Upload Voice Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the IndexTTS/QwenTTS compatibility prompt from every upload and uploaded-voice selection entry while preserving the underlying upload and binding flows.

**Architecture:** Delete the browser confirmation and alert calls at their two component owners, then remove the now-unused localization keys. A focused source regression test protects the cross-entry behavior because this repository does not include a React DOM component-test runtime.

**Tech Stack:** React 19, TypeScript, next-intl, Vitest

## Global Constraints

- Every upload entry must continue immediately without the removed compatibility prompt.
- Existing upload, binding, preview, and business-error handling must remain unchanged.
- Server-side IndexTTS and QwenTTS rules and data structures must remain unchanged.
- Do not modify unrelated existing working-tree changes.

---

### Task 1: Remove the upload voice prompt from all entries

**Files:**
- Create: `tests/unit/voice/upload-voice-prompt-removal.test.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings.tsx:53-55,160-164`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog.tsx:45-47,63-73,82-88,177-181`
- Modify: `messages/zh/assets.json:289`
- Modify: `messages/en/assets.json:289`
- Modify: `messages/zh/voice.json:56`
- Modify: `messages/en/voice.json:56`

**Interfaces:**
- Consumes: Existing file-input refs, `handleVoiceSelected`, and `setSubDialogOpen` state transitions.
- Produces: Direct upload and binding entry behavior with no `uploadQwenHint`, `window.confirm`, or compatibility `alert` calls.

- [ ] **Step 1: Write the failing regression test**

```ts
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
      "onClick={() => setSubDialogOpen(true)}",
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
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run tests/unit/voice/upload-voice-prompt-removal.test.ts`

Expected: FAIL because the components and locale resources still contain `uploadQwenHint`.

- [ ] **Step 3: Remove the prompt logic and locale keys**

In project `VoiceSettings.tsx`, delete `confirmUploadVoice` and replace the upload button handler with:

```tsx
onClick={() => voiceFileInputRef.current?.click()}
```

In `SpeakerVoiceBindingDialog.tsx`, delete `confirmUploadVoice`, delete the compatibility `alert`, remove `t` from the `handleVoiceSelected` dependency list, make `handleTabClick` unconditional:

```ts
const handleTabClick = useCallback((tab: BindingTab) => {
    setActiveTab(tab)
    setSubDialogOpen(true)
}, [])
```

and replace the main action handler with:

```tsx
onClick={() => setSubDialogOpen(true)}
```

Delete the `uploadQwenHint` property from all four locale JSON files.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run: `npx vitest run tests/unit/voice/upload-voice-prompt-removal.test.ts`

Expected: PASS with 1 test passed and 0 failures.

Run: `npx eslint "tests/unit/voice/upload-voice-prompt-removal.test.ts" "src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings.tsx" "src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog.tsx"`

Expected: exit code 0 with no lint errors.

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

Run: `rg -n "uploadQwenHint|上传的音色后续只可使用 IndexTTS|Uploaded voices can only be synthesized with IndexTTS" src messages tests`

Expected: no output and exit code 1, confirming the prompt is absent.

- [ ] **Step 5: Review the scoped diff and commit**

Run: `git diff --check`

Expected: exit code 0.

Run: `git diff -- src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings.tsx src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog.tsx messages/zh/assets.json messages/en/assets.json messages/zh/voice.json messages/en/voice.json tests/unit/voice/upload-voice-prompt-removal.test.ts`

Expected: only the approved prompt removal, locale cleanup, and regression test are present.

```bash
git add tests/unit/voice/upload-voice-prompt-removal.test.ts \
  src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings.tsx \
  src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog.tsx \
  messages/zh/assets.json messages/en/assets.json messages/zh/voice.json messages/en/voice.json
git commit -m "fix: remove uploaded voice compatibility prompt"
```
