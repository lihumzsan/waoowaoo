import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_IMAGE_BYTES } from '@/lib/http/body-limits'
import { readProviderJsonResponse } from '@/lib/ai-providers/failure'
import {
  asComfyUiRecord,
  ComfyUiHttpError,
  readComfyUiString,
} from './transport'
import { H3_CONTINUATION_GUIDE_FRAMES } from '@/lib/video-generation/h3-timeline'

export async function uploadH3ContinuationFrames(input: {
  readonly baseUrl: string
  readonly promptId: string
  readonly framePaths: readonly string[]
}): Promise<readonly string[]> {
  if (input.framePaths.length !== H3_CONTINUATION_GUIDE_FRAMES) {
    throw new Error('COMFYUI_H3_CONTINUATION_FRAME_COUNT_INVALID')
  }
  const subfolder = `waoowaoo/${input.promptId}`
  const uploaded: string[] = []
  for (const [index, framePath] of input.framePaths.entries()) {
    const expectedName = `continuation-${String(index).padStart(2, '0')}.png`
    if (path.basename(framePath) !== expectedName) {
      throw new Error(`COMFYUI_H3_CONTINUATION_FRAME_NAME_INVALID:${String(index)}`)
    }
    const bytes = await readFile(framePath)
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`COMFYUI_H3_CONTINUATION_FRAME_SIZE_INVALID:${String(index)}`)
    }
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), expectedName)
    form.append('type', 'temp')
    form.append('subfolder', subfolder)
    form.append('overwrite', 'false')
    const response = await fetch(`${input.baseUrl.replace(/\/+$/u, '')}/upload/image`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120_000),
      cache: 'no-store',
    })
    const parsed = await readProviderJsonResponse({
      response,
      provider: 'comfyui',
      phase: 'submit',
    })
    if (!response.ok) throw new ComfyUiHttpError(response.status, parsed)
    const record = asComfyUiRecord(parsed)
    const name = readComfyUiString(record?.name)
    const returnedSubfolder = readComfyUiString(record?.subfolder)
    const type = readComfyUiString(record?.type)
    if (name !== expectedName || returnedSubfolder !== subfolder || type !== 'temp') {
      throw new Error(`COMFYUI_H3_CONTINUATION_UPLOAD_RESPONSE_INVALID:${String(index)}`)
    }
    uploaded.push(`${returnedSubfolder}/${name} [temp]`)
  }
  return uploaded
}
