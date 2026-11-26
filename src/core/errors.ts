export interface EcoCashErrorOptions {
  /** EcoCash error code, e.g. "E005", "SBX40000", "888803". */
  code?: string;
  /** HTTP status the API returned, if any. */
  httpStatus?: number;
  /** The raw response body, if any. */
  body?: unknown;
  /** Whether it is safe to retry the same request. */
  retryable?: boolean;
}

/**
 * Base class for every error the SDK produces.
 * Match on `code` (EcoCash's own code), not on `message`.
 */
export class EcoCashError extends Error {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly body?: unknown;
  readonly retryable: boolean;

  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message);
    this.name = "EcoCashError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.body = options.body;
    this.retryable = options.retryable ?? false;
  }
}

/** Bad client credentials, channel user or Basic auth. E006, E007, SBX40100, TP40101. */
export class AuthenticationError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

/** The request was rejected as invalid, by EcoCash or by the SDK before sending. E001–E004, SBX40000. */
export class ValidationError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "ValidationError";
  }
}

/** The reference was already used. E005. */
export class DuplicateReferenceError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "DuplicateReferenceError";
  }
}

/** No transaction for that reference. E008, 888803. */
export class TransactionNotFoundError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "TransactionNotFoundError";
  }
}

/** The transaction cannot be refunded, or the refund exceeds the original. E009, E012. */
export class RefundNotAllowedError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "RefundNotAllowedError";
  }
}

/** Insufficient funds, barred number or limit exceeded. E010, E011, E013. */
export class BusinessRuleError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "BusinessRuleError";
  }
}

/** The channel code does not belong to your API user. TP40288. */
export class InvalidChannelCodeError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "InvalidChannelCodeError";
  }
}

/** The customer number is not on your whitelist / not registered. IC50103. */
export class RecipientNotWhitelistedError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "RecipientNotWhitelistedError";
  }
}

/** EcoCash had a server error or is in maintenance. E014, E015, HTTP 5xx. Safe to retry. */
export class ServiceUnavailableError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, { retryable: true, ...options });
    this.name = "ServiceUnavailableError";
  }
}

/** A sandbox gateway response with a plain message and no code, e.g. "Enable EIP sandbox access". */
export class GatewayError extends EcoCashError {
  constructor(message: string, options: EcoCashErrorOptions = {}) {
    super(message, options);
    this.name = "GatewayError";
  }
}

/** The request timed out or no response arrived. The outcome is unknown. */
export class NetworkError extends EcoCashError {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean, options: EcoCashErrorOptions = {}) {
    super(message, { retryable: true, ...options });
    this.name = "NetworkError";
    this.timedOut = timedOut;
  }
}

type ErrorClass = new (message: string, options?: EcoCashErrorOptions) => EcoCashError;

const CODE_TO_CLASS: Record<string, ErrorClass> = {
  E001: ValidationError,
  E002: ValidationError,
  E003: ValidationError,
  E004: ValidationError,
  E005: DuplicateReferenceError,
  E006: AuthenticationError,
  E007: AuthenticationError,
  E008: TransactionNotFoundError,
  E009: RefundNotAllowedError,
  E010: BusinessRuleError,
  E011: BusinessRuleError,
  E012: RefundNotAllowedError,
  E013: BusinessRuleError,
  E014: ServiceUnavailableError,
  E015: ServiceUnavailableError,
  SBX40100: AuthenticationError,
  TP40101: AuthenticationError,
  SBX40000: ValidationError,
  TP40288: InvalidChannelCodeError,
  IC50103: RecipientNotWhitelistedError,
  "888803": TransactionNotFoundError,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Builds the right error from an EcoCash response body. Handles the three body shapes
 * EcoCash uses: `responseCode`/`message` (EPG), `statusCode`/`statusMessage`
 * (Instant Payments) and message-only gateway responses.
 */
export function errorFromResponse(httpStatus: number | undefined, body: unknown): EcoCashError {
  const record = asRecord(body);
  const code = record ? str(record.responseCode) ?? str(record.statusCode) ?? str(record.code) : undefined;
  const message =
    (record &&
      (str(record.message) ?? str(record.statusMessage) ?? str(record.responseMessage) ?? str(record.error))) ??
    (typeof body === "string" && body.trim() !== "" ? body : undefined) ??
    `EcoCash request failed${httpStatus ? ` with HTTP ${httpStatus}` : ""}`;

  const options: EcoCashErrorOptions = { code, httpStatus, body };

  if (code && CODE_TO_CLASS[code]) {
    return new CODE_TO_CLASS[code](message, options);
  }
  if (httpStatus === 401 || httpStatus === 403) return new AuthenticationError(message, options);
  if (httpStatus === 404) return new TransactionNotFoundError(message, options);
  if (httpStatus === 422) return new BusinessRuleError(message, options);
  if (httpStatus !== undefined && httpStatus >= 500) return new ServiceUnavailableError(message, options);
  if (httpStatus === 400 && !code) return new GatewayError(message, options);
  return new EcoCashError(message, options);
}

interface AxiosLikeError {
  isAxiosError?: boolean;
  code?: string;
  message?: string;
  request?: unknown;
  response?: { status?: number; data?: unknown };
}

/** Converts anything thrown by axios (or our own code) into an EcoCashError. */
export function toEcoCashError(error: unknown): EcoCashError {
  if (error instanceof EcoCashError) return error;

  const err = (error ?? {}) as AxiosLikeError;
  if (err.response) {
    return errorFromResponse(err.response.status, err.response.data);
  }
  if (err.isAxiosError || err.request) {
    const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
    return new NetworkError(
      timedOut ? "Request to EcoCash timed out; the outcome is unknown" : `No response from EcoCash: ${err.message ?? "network error"}`,
      timedOut
    );
  }
  return new EcoCashError(err.message ?? String(error));
}
