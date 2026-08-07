import {
  getSmsDestination,
  isSmsDestinationId,
  SMS_DESTINATIONS,
  type SmsDestinationId,
} from '@/lib/auth/sms-destinations'

interface PhoneNumberInputProps {
  inputId: string
  destinationSelectId: string
  destinationLabel: string
  phoneLabel: string
  destinationId: SmsDestinationId
  phoneNumber: string
  disabled: boolean
  onDestinationChange: (destinationId: SmsDestinationId) => void
  onPhoneNumberChange: (phoneNumber: string) => void
}

export default function PhoneNumberInput({
  inputId,
  destinationSelectId,
  destinationLabel,
  phoneLabel,
  destinationId,
  phoneNumber,
  disabled,
  onDestinationChange,
  onPhoneNumberChange,
}: PhoneNumberInputProps) {
  const selectedDestination = getSmsDestination(destinationId)

  return (
    <div>
      <label htmlFor={inputId} className="mb-2 block text-[13px] font-medium text-slate-700">
        {phoneLabel}
      </label>
      <div className="flex h-12 overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100">
        <div className="relative flex w-[76px] shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50/80">
          <span aria-hidden="true" className="text-sm font-medium text-slate-700">
            +{selectedDestination.callingCode}
          </span>
          <select
            id={destinationSelectId}
            name={destinationSelectId}
            aria-label={destinationLabel}
            value={destinationId}
            disabled={disabled}
            onChange={(event) => {
              if (isSmsDestinationId(event.target.value)) {
                onDestinationChange(event.target.value)
              }
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          >
            {SMS_DESTINATIONS.map((destination) => (
              <option key={destination.id} value={destination.id}>
                +{destination.callingCode}
              </option>
            ))}
          </select>
        </div>
        <input
          id={inputId}
          name="phoneNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={phoneNumber}
          onChange={(event) => onPhoneNumberChange(event.target.value)}
          required
          className="min-w-0 flex-1 border-0 bg-transparent px-4 text-base text-black outline-none"
        />
      </div>
    </div>
  )
}
