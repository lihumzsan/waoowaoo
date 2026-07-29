import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js/core'
import phoneMetadata from 'libphonenumber-js/metadata.min'

export const SMS_DESTINATION_IDS = [
  'CN',
  'HK',
  'MO',
  'TW',
  'JP',
  'KR',
  'MY',
  'GB',
] as const

export type SmsDestinationId = (typeof SMS_DESTINATION_IDS)[number]
export type SmsChannel = 'domestic' | 'international'
export type SmsSenderIdPolicy = 'not-applicable' | 'public-default'

export interface SmsDestination {
  id: SmsDestinationId
  countryCode: CountryCode
  callingCode: string
  flag: string
  exampleNationalNumber: string
  channel: SmsChannel
  senderIdPolicy: SmsSenderIdPolicy
}

interface SmsDestinationDefinition {
  flag: string
  exampleNationalNumber: string
  channel: SmsChannel
  senderIdPolicy: SmsSenderIdPolicy
}

const SMS_DESTINATION_DEFINITIONS: Record<SmsDestinationId, SmsDestinationDefinition> = {
  CN: {
    flag: '🇨🇳',
    exampleNationalNumber: '138 0013 8000',
    channel: 'domestic',
    senderIdPolicy: 'not-applicable',
  },
  HK: {
    flag: '🇭🇰',
    exampleNationalNumber: '5123 4567',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
  MO: {
    flag: '🇲🇴',
    exampleNationalNumber: '6612 3456',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
  TW: {
    flag: '🇹🇼',
    exampleNationalNumber: '0912 345 678',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
  JP: {
    flag: '🇯🇵',
    exampleNationalNumber: '090 1234 5678',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
  KR: {
    flag: '🇰🇷',
    exampleNationalNumber: '010 1234 5678',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
  MY: {
    flag: '🇲🇾',
    exampleNationalNumber: '012 345 6789',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
  GB: {
    flag: '🇬🇧',
    exampleNationalNumber: '07400 123456',
    channel: 'international',
    senderIdPolicy: 'public-default',
  },
}

export const SMS_DESTINATIONS: readonly SmsDestination[] = SMS_DESTINATION_IDS.map((id) => ({
  id,
  countryCode: id,
  callingCode: getCountryCallingCode(id, phoneMetadata),
  ...SMS_DESTINATION_DEFINITIONS[id],
}))

const SMS_DESTINATION_ID_SET = new Set<string>(SMS_DESTINATION_IDS)
const SMS_DESTINATION_BY_ID: Readonly<Record<SmsDestinationId, SmsDestination>> = Object.fromEntries(
  SMS_DESTINATIONS.map((destination) => [destination.id, destination]),
) as Record<SmsDestinationId, SmsDestination>

export function isSmsDestinationId(value: unknown): value is SmsDestinationId {
  return typeof value === 'string' && SMS_DESTINATION_ID_SET.has(value)
}

export function getSmsDestination(id: SmsDestinationId): SmsDestination {
  return SMS_DESTINATION_BY_ID[id]
}

export function getSmsDestinationByCountryCode(
  countryCode: CountryCode | undefined,
): SmsDestination | null {
  return isSmsDestinationId(countryCode)
    ? SMS_DESTINATION_BY_ID[countryCode]
    : null
}
