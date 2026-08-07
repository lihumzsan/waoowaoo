import { describe, expect, it } from 'vitest'
import {
  decryptWechatMessage,
  verifyWechatSignature,
} from '@/lib/auth/wechat-official-crypto'

// Independent oracle published in WeChat's safe-mode encryption specification:
// https://developers.weixin.qq.com/doc/service/guide/dev/push/encryption.html
const OFFICIAL_VECTOR = {
  token: 'AAAAA',
  timestamp: '1714112445',
  nonce: '415670741',
  appId: 'wxba5fad812f8e6fb9',
  encodingAesKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  signature: '046e02f8204d34f8ba5fa3b1db94908f3df2e9b3',
  encrypted: '+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=',
  plaintext: '{"ToUserName":"gh_97417a04a28d","FromUserName":"o9AgO5Kd5ggOC-bXrbNODIiE3bGY","CreateTime":1714112445,"MsgType":"event","Event":"debug_demo","debug_str":"hello world"}',
} as const

describe('WeChat official-account safe-mode protocol', () => {
  it('verifies and decrypts the official WeChat protocol vector', () => {
    expect(verifyWechatSignature({
      expected: OFFICIAL_VECTOR.signature,
      parts: [
        OFFICIAL_VECTOR.token,
        OFFICIAL_VECTOR.timestamp,
        OFFICIAL_VECTOR.nonce,
        OFFICIAL_VECTOR.encrypted,
      ],
    })).toBe(true)

    expect(decryptWechatMessage({
      encrypted: OFFICIAL_VECTOR.encrypted,
      config: {
        appId: OFFICIAL_VECTOR.appId,
        encodingAesKey: OFFICIAL_VECTOR.encodingAesKey,
      },
    })).toBe(OFFICIAL_VECTOR.plaintext)
  })
})
