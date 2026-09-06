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
import { H3_MAX_REFERENCE_AUDIOS, H3_MAX_REFERENCE_IMAGES } from './profiles'

export type H3ReferenceImageFile = {
  readonly bytes: Uint8Array
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  readonly extension: 'jpg' | 'png' | 'webp'
}

export type H3ReferenceAudioFile = {
  readonly bytes: Uint8Array
  readonly contentType: 'audio/mpeg' | 'audio/wav'
  readonly extension: 'mp3' | 'wav'
}

async function uploadH3Input(input: {
  readonly baseUrl: string
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly expectedName: string
  readonly promptId: string
  readonly type: 'input' | 'temp'
  readonly responseErrorCode: string
}): Promise<string> {
  const subfolder = `waoowaoo/${input.promptId}`
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(input.bytes)], { type: input.contentType }), input.expectedName)
  form.append('type', input.type)
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
  if (name !== input.expectedName || returnedSubfolder !== subfolder || type !== input.type) {
    throw new Error(input.responseErrorCode)
  }
  return input.type === 'temp'
    ? `${returnedSubfolder}/${name} [temp]`
    : `${returnedSubfolder}/${name}`
}

export async function uploadH3ContinuationFrames(input: {
  readonly baseUrl: string
  readonly promptId: string
  readonly framePaths: readonly string[]
}): Promise<readonly string[]> {
  if (input.framePaths.length !== H3_CONTINUATION_GUIDE_FRAMES) {
    throw new Error('COMFYUI_H3_CONTINUATION_FRAME_COUNT_INVALID')
  }
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
    uploaded.push(await uploadH3Input({
      baseUrl: input.baseUrl,
      bytes: new Uint8Array(bytes),
      contentType: 'image/png',
      expectedName,
      promptId: input.promptId,
      type: 'temp',
      responseErrorCode: `COMFYUI_H3_CONTINUATION_UPLOAD_RESPONSE_INVALID:${String(index)}`,
    }))
  }
  return uploaded
}

export async function uploadH3ReferenceAudios(input: {
  readonly baseUrl: string
  readonly promptId: string
  readonly files: readonly H3ReferenceAudioFile[]
}): Promise<readonly string[]> {
  if (input.files.length > H3_MAX_REFERENCE_AUDIOS) {
    throw new Error(`COMFYUI_H3_REFERENCE_AUDIOS_COUNT_INVALID:${String(H3_MAX_REFERENCE_AUDIOS)}`)
  }
  const uploaded: string[] = []
  for (const [index, file] of input.files.entries()) {
    if (file.bytes.length === 0) {
      throw new Error(`COMFYUI_H3_REFERENCE_AUDIO_EMPTY:${String(index)}`)
    }
    const expectedContentType = file.extension === 'mp3' ? 'audio/mpeg' : 'audio/wav'
    if (file.contentType !== expectedContentType) {
      throw new Error(`COMFYUI_H3_REFERENCE_AUDIO_FORMAT_MISMATCH:${String(index)}`)
    }
    const expectedName = `reference-audio-${String(index).padStart(2, '0')}.${file.extension}`
    uploaded.push(await uploadH3Input({
      baseUrl: input.baseUrl,
      bytes: file.bytes,
      contentType: file.contentType,
      expectedName,
      promptId: input.promptId,
      type: 'input',
      responseErrorCode: `COMFYUI_H3_REFERENCE_AUDIO_UPLOAD_RESPONSE_INVALID:${String(index)}`,
    }))
  }
  return uploaded
}

export async function uploadH3ReferenceImages(input: {
  readonly baseUrl: string
  readonly promptId: string
  readonly files: readonly H3ReferenceImageFile[]
}): Promise<readonly string[]> {
  if (input.files.length < 1 || input.files.length > H3_MAX_REFERENCE_IMAGES) {
    throw new Error(`COMFYUI_H3_REFERENCE_IMAGES_COUNT_INVALID:${String(H3_MAX_REFERENCE_IMAGES)}`)
  }
  const uploaded: string[] = []
  for (const [index, file] of input.files.entries()) {
    if (file.bytes.length === 0) {
      throw new Error(`COMFYUI_H3_REFERENCE_IMAGE_EMPTY:${String(index)}`)
    }
    if (file.bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`COMFYUI_H3_REFERENCE_IMAGE_SIZE_INVALID:${String(index)}`)
    }
    const expectedContentType = file.extension === 'jpg'
      ? 'image/jpeg'
      : file.extension === 'png'
        ? 'image/png'
        : 'image/webp'
    if (file.contentType !== expectedContentType) {
      throw new Error(`COMFYUI_H3_REFERENCE_IMAGE_FORMAT_MISMATCH:${String(index)}`)
    }
    const expectedName = `reference-image-${String(index).padStart(2, '0')}.${file.extension}`
    uploaded.push(await uploadH3Input({
      baseUrl: input.baseUrl,
      bytes: file.bytes,
      contentType: file.contentType,
      expectedName,
      promptId: input.promptId,
      type: 'input',
      responseErrorCode: `COMFYUI_H3_REFERENCE_IMAGE_UPLOAD_RESPONSE_INVALID:${String(index)}`,
    }))
  }
  return uploaded
}
