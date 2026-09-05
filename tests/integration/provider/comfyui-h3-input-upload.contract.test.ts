import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import * as h3InputUpload from '@/lib/ai-providers/comfyui/h3-input-upload'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

type ReferenceAudioUploader = (input: {
  readonly baseUrl: string
  readonly promptId: string
  readonly files: readonly {
    readonly bytes: Uint8Array
    readonly contentType: 'audio/mpeg' | 'audio/wav'
    readonly extension: 'mp3' | 'wav'
  }[]
}) => Promise<readonly string[]>

function requireReferenceAudioUploader(): ReferenceAudioUploader {
  const candidate: unknown = Reflect.get(h3InputUpload, 'uploadH3ReferenceAudios')
  expect(candidate, 'uploadH3ReferenceAudios export').toBeTypeOf('function')
  if (typeof candidate !== 'function') throw new Error('uploadH3ReferenceAudios export missing')
  return candidate as ReferenceAudioUploader
}

describe('ComfyUI H3 continuation input upload', () => {
  let directory = ''
  let server: Awaited<ReturnType<typeof startScenarioServer>> | null = null

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
    await server?.close()
    directory = ''
    server = null
  })

  it('uploads 22 ordered PNGs into the prompt-scoped temporary directory', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-upload-'))
    server = await startScenarioServer()
    const framePaths: string[] = []
    const responses = []
    for (let index = 0; index < 22; index += 1) {
      const filename = `continuation-${String(index).padStart(2, '0')}.png`
      const framePath = path.join(directory, filename)
      await writeFile(framePath, await sharp({
        create: { width: 32, height: 32, channels: 3, background: { r: index, g: 0, b: 0 } },
      }).png().toBuffer())
      framePaths.push(framePath)
      responses.push({
        status: 200,
        body: { name: filename, subfolder: 'waoowaoo/prompt-id', type: 'temp' },
      })
    }
    server.defineScenario({
      method: 'POST',
      path: '/upload/image',
      mode: 'success',
      pollSequence: responses,
    })

    const uploaded = await h3InputUpload.uploadH3ContinuationFrames({
      baseUrl: server.baseUrl,
      promptId: 'prompt-id',
      framePaths,
    })

    expect(uploaded).toEqual(framePaths.map((framePath) => (
      `waoowaoo/prompt-id/${path.basename(framePath)} [temp]`
    )))
    const requests = server.getRequests('POST', '/upload/image')
    expect(requests).toHaveLength(22)
    expect(requests[0]?.bodyText).toContain('continuation-00.png')
    expect(requests[0]?.bodyText).toContain('temp')
    expect(requests.at(-1)?.bodyText).toContain('continuation-21.png')
  })

  it('uploads ordered MP3 and WAV bytes into the prompt-scoped input directory', async () => {
    server = await startScenarioServer()
    server.defineScenario({
      method: 'POST',
      path: '/upload/image',
      mode: 'success',
      pollSequence: [
        {
          status: 200,
          body: { name: 'reference-audio-00.mp3', subfolder: 'waoowaoo/prompt-id', type: 'input' },
        },
        {
          status: 200,
          body: { name: 'reference-audio-01.wav', subfolder: 'waoowaoo/prompt-id', type: 'input' },
        },
      ],
    })

    const uploaded = await requireReferenceAudioUploader()({
      baseUrl: server.baseUrl,
      promptId: 'prompt-id',
      files: [
        { bytes: new Uint8Array([0x49, 0x44, 0x33]), contentType: 'audio/mpeg', extension: 'mp3' },
        { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), contentType: 'audio/wav', extension: 'wav' },
      ],
    })

    expect(uploaded).toEqual([
      'waoowaoo/prompt-id/reference-audio-00.mp3',
      'waoowaoo/prompt-id/reference-audio-01.wav',
    ])
    const requests = server.getRequests('POST', '/upload/image')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.bodyText).toContain('reference-audio-00.mp3')
    expect(requests[0]?.bodyText).toContain('audio/mpeg')
    expect(requests[0]?.bodyText).toContain('input')
    expect(requests[1]?.bodyText).toContain('reference-audio-01.wav')
    expect(requests[1]?.bodyText).toContain('audio/wav')
  })

  it('rejects a renamed reference-audio upload response', async () => {
    server = await startScenarioServer()
    server.defineScenario({
      method: 'POST',
      path: '/upload/image',
      mode: 'success',
      pollSequence: [{
        status: 200,
        body: {
          name: 'renamed.mp3',
          subfolder: 'waoowaoo/prompt-id',
          type: 'input',
        },
      }],
    })

    await expect(requireReferenceAudioUploader()({
      baseUrl: server.baseUrl,
      promptId: 'prompt-id',
      files: [
        { bytes: new Uint8Array([0x49, 0x44, 0x33]), contentType: 'audio/mpeg', extension: 'mp3' },
      ],
    })).rejects.toThrow('COMFYUI_H3_REFERENCE_AUDIO_UPLOAD_RESPONSE_INVALID:0')
  })
})
