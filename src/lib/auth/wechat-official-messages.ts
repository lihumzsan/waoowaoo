import type { Locale } from '@/i18n/routing'
import type { WechatOfficialResultCode } from '@/lib/auth/wechat-official-config'
import { WECHAT_OFFICIAL_RESULT_CODES } from '@/lib/auth/wechat-official-config'

const WECHAT_OFFICIAL_MESSAGES = {
  zh: {
    ready: '登录成功，请返回浏览器继续使用 waoowaoo。',
    bound: '绑定成功，请返回浏览器继续使用 waoowaoo。',
    expired: '二维码已过期，请返回 waoowaoo 登录页刷新后重试。',
    identityConflict: '该微信已绑定其他账号，请返回 waoowaoo 使用原账号登录。',
    failed: '本次扫码登录未完成，请返回 waoowaoo 重试。',
  },
  en: {
    ready: 'Signed in. Return to your browser to continue with waoowaoo.',
    bound: 'WeChat linked. Return to your browser to continue with waoowaoo.',
    expired: 'This QR code has expired. Refresh the waoowaoo sign-in page and try again.',
    identityConflict: 'This WeChat account is linked to another account. Sign in with that account.',
    failed: 'WeChat sign-in was not completed. Return to waoowaoo and try again.',
  },
} as const satisfies Record<Locale, Record<string, string>>

export function wechatOfficialReplyMessage(input: {
  locale: Locale
  status: 'ready' | 'expired' | 'failed'
  mode?: 'login' | 'bind'
  code?: WechatOfficialResultCode
}): string {
  const messages = WECHAT_OFFICIAL_MESSAGES[input.locale]
  if (input.status === 'ready') {
    return input.mode === 'bind' ? messages.bound : messages.ready
  }
  if (input.status === 'expired') return messages.expired
  if (input.code === WECHAT_OFFICIAL_RESULT_CODES.identityConflict) {
    return messages.identityConflict
  }
  return messages.failed
}
