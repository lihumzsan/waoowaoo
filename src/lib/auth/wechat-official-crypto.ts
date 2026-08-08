import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import type { WechatOfficialConfig } from '@/lib/auth/wechat-official-config'
import {
  WECHAT_OFFICIAL_RESULT_CODES,
  WechatOfficialError,
} from '@/lib/auth/wechat-official-config'

const WECHAT_PKCS7_BLOCK_SIZE = 32

export interface WechatEventMessage {
  toUserName: string
  openId: string
  createTime: string
  event: string
  eventKey: string
}

function callbackInvalid(cause?: unknown): never {
  throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.callbackInvalid, cause)
}

function signatureFor(parts: readonly string[]): string {
  return createHash('sha1').update([...parts].sort().join('')).digest('hex')
}

export function verifyWechatSignature(input: {
  expected: string
  parts: readonly string[]
}): boolean {
  if (!/^[a-f0-9]{40}$/iu.test(input.expected)) return false
  const actual = Buffer.from(signatureFor(input.parts), 'hex')
  const expected = Buffer.from(input.expected, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function readAesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  if (key.length !== 32) callbackInvalid()
  return key
}

function addWechatPadding(payload: Buffer): Buffer {
  const remainder = payload.length % WECHAT_PKCS7_BLOCK_SIZE
  const paddingLength = remainder === 0
    ? WECHAT_PKCS7_BLOCK_SIZE
    : WECHAT_PKCS7_BLOCK_SIZE - remainder
  return Buffer.concat([payload, Buffer.alloc(paddingLength, paddingLength)])
}

function removeWechatPadding(payload: Buffer): Buffer {
  if (payload.length === 0) callbackInvalid()
  const paddingLength = payload[payload.length - 1]
  if (paddingLength < 1 || paddingLength > WECHAT_PKCS7_BLOCK_SIZE) callbackInvalid()
  const padding = payload.subarray(payload.length - paddingLength)
  for (const byte of padding) {
    if (byte !== paddingLength) callbackInvalid()
  }
  return payload.subarray(0, payload.length - paddingLength)
}

export function decryptWechatMessage(input: {
  encrypted: string
  config: Pick<WechatOfficialConfig, 'appId' | 'encodingAesKey'>
}): string {
  try {
    const key = readAesKey(input.config.encodingAesKey)
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
    decipher.setAutoPadding(false)
    const padded = Buffer.concat([
      decipher.update(Buffer.from(input.encrypted, 'base64')),
      decipher.final(),
    ])
    const decrypted = removeWechatPadding(padded)
    if (decrypted.length < 20) callbackInvalid()
    const messageLength = decrypted.readUInt32BE(16)
    const messageStart = 20
    const messageEnd = messageStart + messageLength
    if (messageEnd > decrypted.length) callbackInvalid()
    const message = decrypted.subarray(messageStart, messageEnd).toString('utf8')
    const receiverId = decrypted.subarray(messageEnd).toString('utf8')
    if (receiverId !== input.config.appId) callbackInvalid()
    return message
  } catch (error) {
    if (error instanceof WechatOfficialError) throw error
    callbackInvalid(error)
  }
}

export function encryptWechatMessage(input: {
  message: string
  config: Pick<WechatOfficialConfig, 'appId' | 'encodingAesKey'>
}): string {
  const key = readAesKey(input.config.encodingAesKey)
  const message = Buffer.from(input.message, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(message.length)
  const raw = Buffer.concat([
    randomBytes(16),
    length,
    message,
    Buffer.from(input.config.appId, 'utf8'),
  ])
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([
    cipher.update(addWechatPadding(raw)),
    cipher.final(),
  ]).toString('base64')
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

export function readWechatXmlField(xml: string, tag: string): string | null {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(tag)) callbackInvalid()
  const cdataPattern = new RegExp(
    `<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    'u',
  )
  const cdataMatch = cdataPattern.exec(xml)
  if (cdataMatch) return cdataMatch[1]
  const textPattern = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, 'u')
  const textMatch = textPattern.exec(xml)
  return textMatch ? decodeXmlText(textMatch[1]) : null
}

export function parseWechatEventMessage(xml: string): WechatEventMessage | null {
  const msgType = readWechatXmlField(xml, 'MsgType')
  const toUserName = readWechatXmlField(xml, 'ToUserName')
  const openId = readWechatXmlField(xml, 'FromUserName')
  const createTime = readWechatXmlField(xml, 'CreateTime')
  if (!msgType || !toUserName || !openId || !createTime) {
    callbackInvalid()
  }
  if (msgType !== 'event') return null

  const event = readWechatXmlField(xml, 'Event')
  if (!event) callbackInvalid()
  return {
    toUserName,
    openId,
    createTime,
    event,
    eventKey: readWechatXmlField(xml, 'EventKey') ?? '',
  }
}

function cdata(value: string): string {
  if (value.includes(']]>')) callbackInvalid()
  return `<![CDATA[${value}]]>`
}

export function createWechatTextReply(input: {
  toOpenId: string
  fromUserName: string
  content: string
  timestamp: string
}): string {
  return `<xml><ToUserName>${cdata(input.toOpenId)}</ToUserName><FromUserName>${cdata(input.fromUserName)}</FromUserName><CreateTime>${input.timestamp}</CreateTime><MsgType>${cdata('text')}</MsgType><Content>${cdata(input.content)}</Content></xml>`
}

export function createEncryptedWechatReply(input: {
  plaintextXml: string
  timestamp: string
  nonce: string
  config: WechatOfficialConfig
}): string {
  const encrypted = encryptWechatMessage({
    message: input.plaintextXml,
    config: input.config,
  })
  const signature = signatureFor([
    input.config.token,
    input.timestamp,
    input.nonce,
    encrypted,
  ])
  return `<xml><Encrypt>${cdata(encrypted)}</Encrypt><MsgSignature>${cdata(signature)}</MsgSignature><TimeStamp>${input.timestamp}</TimeStamp><Nonce>${cdata(input.nonce)}</Nonce></xml>`
}
