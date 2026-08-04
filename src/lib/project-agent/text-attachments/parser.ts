import { createHash, randomUUID } from 'node:crypto'
import mammoth from 'mammoth'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES,
  type ProjectAssistantTextAttachment,
  type ProjectAssistantTextAttachmentKind,
} from './types'

type SupportedFileExtension = 'txt' | 'md' | 'markdown' | 'docx'

function normalizeFileName(value: string): string {
  const fileName = value.trim().replace(/[\\/\u0000]/g, '_')
  if (!fileName) throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_FILE_NAME_EMPTY')
  return fileName
}

function readExtension(fileName: string): SupportedFileExtension | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!match) return null
  const extension = match[1]
  if (extension === 'txt' || extension === 'md' || extension === 'markdown' || extension === 'docx') {
    return extension
  }
  return null
}

function resolveKind(extension: SupportedFileExtension): ProjectAssistantTextAttachmentKind {
  if (extension === 'docx') return 'docx'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  return 'txt'
}

function normalizeText(rawText: string): string {
  const normalized = rawText
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .trim()
  if (!normalized) throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_EMPTY')
  if (normalized.length > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_CHAR_LIMIT_EXCEEDED')
  }
  return normalized
}

function checksumText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function createAttachmentId(checksum: string): string {
  return `text-attachment:${checksum.slice(0, 16)}:${randomUUID()}`
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

export async function parseProjectAssistantTextAttachmentFile(file: File): Promise<ProjectAssistantTextAttachment> {
  const fileName = normalizeFileName(file.name)
  const extension = readExtension(fileName)
  if (!extension) throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_UNSUPPORTED_TYPE')
  if (file.size <= 0) throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_EMPTY')
  if (file.size > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_SIZE_LIMIT_EXCEEDED')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const rawText = extension === 'docx'
    ? await extractTextFromDocx(buffer)
    : new TextDecoder('utf-8').decode(buffer)
  const normalizedText = normalizeText(rawText)
  const checksum = checksumText(normalizedText)
  return {
    id: createAttachmentId(checksum),
    kind: resolveKind(extension),
    fileName,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    checksum,
    charCount: normalizedText.length,
    normalizedText,
  }
}
