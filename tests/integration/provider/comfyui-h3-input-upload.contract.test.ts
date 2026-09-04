import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { uploadH3ContinuationFrames } from '@/lib/ai-providers/comfyui/h3-input-upload'
import { startScenarioServer } from '../../helpers/fakes/scenario-server'

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

    const uploaded = await uploadH3ContinuationFrames({
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
})
