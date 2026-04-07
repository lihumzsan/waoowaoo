import { logError as _ulogError } from '@/lib/logging/core'
import sharp from 'sharp'
import { uploadObject, getSignedUrl, generateUniqueKey, toFetchableUrl } from '@/lib/storage'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'

async function downloadImageBuffer(imageUrl: string): Promise<Buffer> {
  const storageKey = await resolveStorageKeyFromMediaValue(imageUrl)
  if (!storageKey) {
    throw new Error(`无法归一化媒体 key: ${imageUrl}`)
  }

  const signedUrl = getSignedUrl(storageKey, 3600)
  const response = await fetch(toFetchableUrl(signedUrl))
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function createLabeledImageBuffer(sourceBuffer: Buffer, labelText: string): Promise<Buffer> {
  await initializeFonts()

  const meta = await sharp(sourceBuffer).metadata()
  const width = meta.width || 2160
  const height = meta.height || 2160
  const fontSize = Math.floor(height * 0.04)
  const pad = Math.floor(fontSize * 0.5)
  const barHeight = fontSize + pad * 2
  const svg = await createLabelSVG(width, barHeight, fontSize, pad, labelText)

  return await sharp(sourceBuffer)
    .extend({
      top: barHeight,
      bottom: 0,
      left: 0,
      right: 0,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

export async function updateImageLabel(
  imageUrl: string,
  newLabelText: string,
  options?: {
    generateNewKey?: boolean
    keyPrefix?: string
  },
): Promise<string> {
  const originalKey = await resolveStorageKeyFromMediaValue(imageUrl)
  if (!originalKey) {
    throw new Error(`无法归一化媒体 key: ${imageUrl}`)
  }

  const buffer = await downloadImageBuffer(imageUrl)
  const meta = await sharp(buffer).metadata()
  const width = meta.width || 2160
  const height = meta.height || 2160
  const fontSize = Math.floor(height * 0.04)
  const pad = Math.floor(fontSize * 0.5)
  const barHeight = fontSize + pad * 2
  const croppedBuffer = await sharp(buffer)
    .extract({ left: 0, top: barHeight, width, height: height - barHeight })
    .toBuffer()
  const processed = await createLabeledImageBuffer(croppedBuffer, newLabelText)

  const finalKey = options?.generateNewKey
    ? generateUniqueKey(options.keyPrefix || 'labeled-image', 'jpg')
    : originalKey

  await uploadObject(processed, finalKey)
  return finalKey
}

export async function createProjectCharacterLabeledCopies(
  appearances: Array<{
    imageUrl: string | null
    imageUrls: string
    changeReason: string
  }>,
  characterName: string,
): Promise<Array<{ imageUrl: string | null; imageUrls: string }>> {
  const results: Array<{ imageUrl: string | null; imageUrls: string }> = []

  for (const appearance of appearances) {
    try {
      let imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'appearance.imageUrls')
      if (imageUrls.length === 0 && appearance.imageUrl) {
        imageUrls = [appearance.imageUrl]
      }

      if (imageUrls.length === 0) {
        results.push({ imageUrl: null, imageUrls: encodeImageUrls([]) })
        continue
      }

      const labelText = `${characterName} - ${appearance.changeReason}`
      const labeledImageUrls = await Promise.all(
        imageUrls.map(async (imageUrl) => {
          if (!imageUrl) return ''
          try {
            const sourceBuffer = await downloadImageBuffer(imageUrl)
            const processed = await createLabeledImageBuffer(sourceBuffer, labelText)
            const newKey = generateUniqueKey('project-char-copy', 'jpg')
            await uploadObject(processed, newKey)
            return newKey
          } catch (error) {
            _ulogError('Failed to create project character labeled copy:', error)
            return imageUrl
          }
        }),
      )

      results.push({
        imageUrl: labeledImageUrls.find((url) => !!url) || null,
        imageUrls: encodeImageUrls(labeledImageUrls),
      })
    } catch (error) {
      _ulogError('Failed to copy project character images:', error)
      results.push({ imageUrl: appearance.imageUrl, imageUrls: appearance.imageUrls })
    }
  }

  return results
}

export async function createProjectLocationLabeledCopies(
  images: Array<{ imageUrl: string | null }>,
  locationName: string,
): Promise<Array<{ imageUrl: string | null }>> {
  const results: Array<{ imageUrl: string | null }> = []

  for (const image of images) {
    if (!image.imageUrl) {
      results.push({ imageUrl: null })
      continue
    }

    try {
      const sourceBuffer = await downloadImageBuffer(image.imageUrl)
      const processed = await createLabeledImageBuffer(sourceBuffer, locationName)
      const newKey = generateUniqueKey('project-location-copy', 'jpg')
      await uploadObject(processed, newKey)
      results.push({ imageUrl: newKey })
    } catch (error) {
      _ulogError('Failed to create project location labeled copy:', error)
      results.push({ imageUrl: image.imageUrl })
    }
  }

  return results
}
