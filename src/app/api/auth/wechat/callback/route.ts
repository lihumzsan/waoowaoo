import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { processWechatOfficialScan } from '@/lib/auth/wechat-official-attempt'
import { readWechatOfficialConfig, WechatOfficialError } from '@/lib/auth/wechat-official-config'
import {
  createEncryptedWechatReply,
  createWechatTextReply,
  decryptWechatMessage,
  parseWechatEventMessage,
  readWechatXmlField,
  verifyWechatSignature,
} from '@/lib/auth/wechat-official-crypto'
import { wechatOfficialReplyMessage } from '@/lib/auth/wechat-official-messages'

const MAX_CALLBACK_BODY_BYTES = 256 * 1024

function textResponse(body: string, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  })
}

export const GET = apiHandler(async (request: NextRequest) => {
  try {
    const config = readWechatOfficialConfig()
    const timestamp = request.nextUrl.searchParams.get('timestamp') || ''
    const nonce = request.nextUrl.searchParams.get('nonce') || ''
    const echo = request.nextUrl.searchParams.get('echostr') || ''
    if (!timestamp || !nonce || !echo) return textResponse('invalid callback', 400)

    const encryptedSignature = request.nextUrl.searchParams.get('msg_signature') || ''
    if (encryptedSignature) {
      if (!verifyWechatSignature({
        expected: encryptedSignature,
        parts: [config.token, timestamp, nonce, echo],
      })) {
        return textResponse('invalid callback', 400)
      }
      return textResponse(decryptWechatMessage({ encrypted: echo, config }))
    }

    const plaintextSignature = request.nextUrl.searchParams.get('signature') || ''
    if (
      !plaintextSignature
      || !verifyWechatSignature({
        expected: plaintextSignature,
        parts: [config.token, timestamp, nonce],
      })
    ) {
      return textResponse('invalid callback', 400)
    }
    return textResponse(echo)
  } catch (error) {
    if (error instanceof WechatOfficialError) return textResponse('invalid callback', 400)
    throw error
  }
})

export const POST = apiHandler(async (request: NextRequest) => {
  try {
    const config = readWechatOfficialConfig()
    const signature = request.nextUrl.searchParams.get('msg_signature') || ''
    const timestamp = request.nextUrl.searchParams.get('timestamp') || ''
    const nonce = request.nextUrl.searchParams.get('nonce') || ''
    if (!signature || !timestamp || !nonce) return textResponse('invalid callback', 400)

    const declaredLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BODY_BYTES) {
      return textResponse('invalid callback', 400)
    }
    const body = await request.text()
    if (!body || Buffer.byteLength(body, 'utf8') > MAX_CALLBACK_BODY_BYTES) {
      return textResponse('invalid callback', 400)
    }
    const encrypted = readWechatXmlField(body, 'Encrypt')
    if (
      !encrypted
      || !verifyWechatSignature({
        expected: signature,
        parts: [config.token, timestamp, nonce, encrypted],
      })
    ) {
      return textResponse('invalid callback', 400)
    }

    const messageXml = decryptWechatMessage({ encrypted, config })
    const message = parseWechatEventMessage(messageXml)
    if (!message) return textResponse('success')
    const processed = await processWechatOfficialScan({
      event: message.event,
      eventKey: message.eventKey,
      openId: message.openId,
    })
    if (processed.status === 'ignored') return textResponse('success')

    const responseTimestamp = String(Math.floor(Date.now() / 1000))
    const responseNonce = randomBytes(12).toString('hex')
    const content = wechatOfficialReplyMessage({
      locale: processed.locale,
      status: processed.status,
      mode: processed.mode,
      code: processed.code,
    })
    const replyXml = createWechatTextReply({
      toOpenId: message.openId,
      fromUserName: message.toUserName,
      content,
      timestamp: responseTimestamp,
    })
    const encryptedReply = createEncryptedWechatReply({
      plaintextXml: replyXml,
      timestamp: responseTimestamp,
      nonce: responseNonce,
      config,
    })
    return textResponse(encryptedReply, 200, 'application/xml; charset=utf-8')
  } catch (error) {
    if (error instanceof WechatOfficialError) return textResponse('invalid callback', 400)
    throw error
  }
})
