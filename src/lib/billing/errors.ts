export class InsufficientBalanceError extends Error {
  public available: number
  public required: number

  constructor(required: number, available: number) {
    super(
      `INSUFFICIENT_CREDITS: required=${required}, available=${available}`,
    )
    this.name = 'InsufficientBalanceError'
    this.required = required
    this.available = available
  }
}

export type BillingOperationErrorCode =
  | 'BILLING_CONFIRM_FAILED'
  | 'BILLING_FREEZE_FAILED'
  | 'BILLING_INVALID_FREEZE_AMOUNT'
  | 'BILLING_INVALID_FREEZE'
  | 'BILLING_INVALID_API_TYPE'
  | 'BILLING_FREEZE_NOT_PENDING'
  | 'BILLING_INVALID_CHARGED_AMOUNT'
  | 'BILLING_INVALID_DELTA'
  | 'BILLING_INVALID_ADJUSTMENT_AMOUNT'
  | 'BILLING_ADJUSTMENT_IDEMPOTENCY_CONFLICT'
  | 'BILLING_FREEZE_EXPAND_FAILED'
  | 'BILLING_UNKNOWN_MODEL'
  | 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
  | 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
  | 'BILLING_CAPABILITY_PRICE_NOT_FOUND'
  | 'BILLING_PRICING_MODEL_AMBIGUOUS'
  | 'BILLING_IDEMPOTENT_ALREADY_CONFIRMED'
  | 'BILLING_IDEMPOTENT_IN_PROGRESS'
  | 'BILLING_IDEMPOTENT_ROLLED_BACK'
  | 'BILLING_INVALID_PROJECT'
  | 'BILLING_BALANCE_NOT_FOUND'
  | 'BILLING_BALANCE_DEBIT_CONFLICT'
  | 'BILLING_FREEZE_OWNERSHIP_MISMATCH'
  | 'BILLING_INVALID_USAGE_IDENTITY'
  | 'BILLING_USAGE_REPLAY_DIVERGED'

export class BillingOperationError extends Error {
  public readonly code: BillingOperationErrorCode
  public readonly details?: Record<string, unknown>
  public readonly cause?: unknown

  constructor(
    code: BillingOperationErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'BillingOperationError'
    this.code = code
    this.details = details
    this.cause = cause
  }
}
