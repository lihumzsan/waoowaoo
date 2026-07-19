import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = 'src/app/api/novel-promotion/[projectId]/free-voices'

describe('free voice API contract', () => {
  it('retires project-scoped write routes for free voice records', () => {
    const collection = fs.readFileSync(`${root}/route.ts`, 'utf8')
    const record = fs.readFileSync(`${root}/[recordId]/route.ts`, 'utf8')
    const versions = fs.readFileSync(`${root}/[recordId]/versions/route.ts`, 'utf8')
    const keep = fs.readFileSync(`${root}/[recordId]/keep-version/route.ts`, 'utf8')

    expect(collection).toMatch(/export const GET/)
    expect(record).toMatch(/export const DELETE/)
    expect(versions).toMatch(/export const POST/)
    expect(keep).toMatch(/export const POST/)
    expect(collection).not.toContain('createFreeVoiceRecord')
    expect(versions).not.toContain('createFreeVoiceVersion')
    expect(keep).not.toContain('keepOnlyFreeVoiceVersion')
    expect(record).not.toContain('deleteFreeVoiceRecord')
    expect(`${record}\n${versions}\n${keep}`).toContain('PROJECT_FREE_VOICE_RETIRED_USE_VIDEO_TOOLS')
  })

  it('keeps video-tools free voice separate from project database records', () => {
    const service = fs.readFileSync('src/lib/video-tools/free-voice.ts', 'utf8')
    expect(service).not.toContain('novelPromotionVoiceLine.create')
    expect(service).not.toContain('novelPromotionVoiceLine.update')
    expect(service).not.toContain('novelPromotionFreeVoiceRecord.create')
    expect(service).not.toContain('novelPromotionFreeVoiceVersion.create')
    expect(service).toContain("targetType: VIDEO_TOOL_FREE_VOICE_TARGET_TYPE")
    expect(service).toContain("persistence: 'transient'")
    expect(service).toContain('VIDEO_TOOL_FREE_VOICE_TTL_SECONDS = 86_400')
    expect(service).toContain('FREE_VOICE_COMFYUI_REQUIRED')
  })
})
