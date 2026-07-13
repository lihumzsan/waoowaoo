import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = 'src/app/api/novel-promotion/[projectId]/free-voices'

describe('free voice API contract', () => {
  it('exposes independent list/create/regenerate/keep/delete routes', () => {
    const collection = fs.readFileSync(`${root}/route.ts`, 'utf8')
    const record = fs.readFileSync(`${root}/[recordId]/route.ts`, 'utf8')
    const versions = fs.readFileSync(`${root}/[recordId]/versions/route.ts`, 'utf8')
    const keep = fs.readFileSync(`${root}/[recordId]/keep-version/route.ts`, 'utf8')

    expect(collection).toMatch(/export const GET/)
    expect(collection).toMatch(/export const POST/)
    expect(record).toMatch(/export const DELETE/)
    expect(versions).toMatch(/export const POST/)
    expect(keep).toMatch(/export const POST/)
    expect(collection).toContain('createFreeVoiceRecord')
    expect(versions).toContain('createFreeVoiceVersion')
    expect(keep).toContain('keepOnlyFreeVoiceVersion')
    expect(record).toContain('deleteFreeVoiceRecord')
  })

  it('keeps free voice separate from formal dialogue lines', () => {
    const service = fs.readFileSync('src/lib/voice/free-voice.ts', 'utf8')
    expect(service).not.toContain('novelPromotionVoiceLine.create')
    expect(service).not.toContain('novelPromotionVoiceLine.update')
    expect(service).toContain("targetType: 'NovelPromotionFreeVoiceVersion'")
    expect(service).toContain('FREE_VOICE_COMFYUI_REQUIRED')
    expect(service).toMatch(/compensat/i)
  })
})
