import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js/core'
import phoneMetadata from 'libphonenumber-js/metadata.min'

export const SMS_DESTINATION_IDS = ['CN'] as const

export type SmsDestinationId = (typeof SMS_DESTINATION_IDS)[number]

export interface SmsDestination {
  id: SmsDestinationId
  countryCode: CountryCode
  callingCode: string
  exampleNationalNumber: string
}

interface SmsDestinationDefinition {
  exampleNationalNumber: string
}

const SMS_DESTINATION_DEFINITIONS: Record<SmsDestinationId, SmsDestinationDefinition> = {
  CN: {
    exampleNationalNumber: '138 0013 8000',
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
