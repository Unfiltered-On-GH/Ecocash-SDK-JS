import type { AxiosAdapter } from "axios";

export type Currency = "USD" | "ZWG";
export type Environment = "sandbox" | "live";

/** Every code the EcoCash APIs are documented to return, plus the SDK's own. */
export type EcoCashErrorCode =
  | "E001" | "E002" | "E003" | "E004" | "E005" | "E006" | "E007" | "E008"
  | "E009" | "E010" | "E011" | "E012" | "E013" | "E014" | "E015"
  | "SBX40100" | "TP40101" | "SBX40000" | "TP40288" | "IC50103" | "888803"
  | "CLIENT_VALIDATION";

interface CommonConfig {
  /** "sandbox" (default) or "live". */
  environment?: Environment;
  /** Overrides the default URL. Required for "live". */
  baseURL?: string;
  /** Request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Custom axios adapter. Mainly for tests. */
  adapter?: AxiosAdapter;
}

// ---------------------------------------------------------------------------
// Online (Instant) Payments
// ---------------------------------------------------------------------------

export interface OnlinePaymentsConfig extends CommonConfig {
  /** Basic auth username from the credentials page. */
  username: string;
  /** Basic auth password from the credentials page. */
  password: string;
  merchantCode: string;
  merchantPin: string;
  merchantNumber: string;
  terminalId: string;
  location: string;
  merchantName: string;
  superMerchantName: string;
  /** Default "ZW". */
  countryCode?: string;
  /** Default "WEB". */
  channel?: string;
  purchaseCategoryCode?: string;
  onBehalfOf?: string;
  /** Default callback URL for charges and refunds. */
  notifyUrl?: string;
}

export interface ChargeRequest {
  /** Econet number (077/078) as 9, 10 or 12 digits. */
  phoneNumber: string;
  amount: number;
  currency: Currency;
  description: string;
  /** Your clientCorrelator. Generated when omitted. Must be new for every charge. */
  reference?: string;
  /** Shown as referenceCode. Defaults to the reference. */
  referenceCode?: string;
  notifyUrl?: string;
}

export interface RefundRequest {
  /** ecocashReference of the original charge. */
  originalEcocashReference: string;
  phoneNumber: string;
  amount: number;
  currency: Currency;
  description: string;
  /** Fresh clientCorrelator for this refund. Generated when omitted. */
  reference?: string;
  referenceCode?: string;
  notifyUrl?: string;
}

export interface LookupRequest {
  phoneNumber: string;
  /** The clientCorrelator of the charge. */
  reference: string;
}

/** Raw response of the Instant Payment API. */
export interface InstantPaymentResponseBody {
  clientCorrelator?: string;
  referenceCode?: string;
  endUserId?: string;
  ecocashReference?: string;
  originalEcocashReference?: string;
  transactionOperationStatus?: string;
  responseCode?: string;
  [key: string]: unknown;
}

export interface Payment {
  /** Your clientCorrelator. */
  reference: string;
  referenceCode?: string;
  phoneNumber?: string;
  ecocashReference?: string;
  originalEcocashReference?: string;
  /** e.g. "Charged", "Refunded". */
  status?: string;
  responseCode?: string;
  raw: InstantPaymentResponseBody;
}

// ---------------------------------------------------------------------------
// EPG services
// ---------------------------------------------------------------------------

export interface ChannelCodes {
  /** Default "700002". */
  cashIn?: string;
  /** Default "800002". */
  disburseChange?: string;
  /** Default "800004". */
  merchantToSubscriber?: string;
}

export interface EpgConfig extends CommonConfig {
  clientId: string;
  clientSecret: string;
  /** Channel API user. Not needed if you only use lookupTransaction. */
  username?: string;
  /** Plain password. Encrypted with encryptionKey (or encryptPassword) on every request. */
  password?: string;
  encryptionKey?: string;
  /** Already-encrypted password, sent as is. */
  encryptedPassword?: string;
  /** Custom encryption function, used instead of the built-in one. */
  encryptPassword?: (password: string) => string;
  channelCodes?: ChannelCodes;
  /** Default "12". */
  walletId?: string;
  /** Default terminalId for disburseChange. */
  terminalId?: string;
  /** Default merchantName for disburseChange. */
  merchantName?: string;
  /**
   * Extra attempts after a retryable error (timeout, 5xx). Default 0.
   * Safe because EPG is idempotent on externalReference.
   */
  retries?: number;
}

export interface CashInRequest {
  phoneNumber: string;
  amount: number;
  currency: Currency;
  beneficiaryReference: string;
  transferReference?: string;
  reference?: string;
}

export interface DisburseChangeRequest {
  phoneNumber: string;
  amount: number;
  currency: Currency;
  transferReference?: string;
  terminalId?: string;
  merchantName?: string;
  reference?: string;
}

export interface MerchantToSubscriberRequest {
  phoneNumber: string;
  amount: number;
  currency: Currency;
  transferReference?: string;
  /** Digits only; sent as a number. */
  reference?: string;
}

export interface TransactionLookupRequest {
  /** The externalReference of the transaction to find. */
  transactionReference: string;
  phoneNumber: string;
  currency: Currency;
  /** Reference for the lookup call itself. Generated when omitted. */
  lookupReference?: string;
}

/** Raw EPG response body. Field names and types vary by service. */
export interface EpgResponseBody {
  serviceType?: string;
  externalReference?: string | number;
  externalTransactionId?: string;
  transactionId?: string;
  requestId?: string;
  status?: string | number;
  statusCode?: string;
  statusMessage?: string;
  responseCode?: string;
  responseMessage?: string;
  senderNumber?: string;
  senderName?: string;
  senderPostBalance?: string;
  receiverName?: string;
  receiverNumber?: string;
  receiverMsisdn?: string;
  amount?: string | number;
  currency?: string;
  transferReference?: string;
  timestamp?: string;
  timeStamp?: string;
  [key: string]: unknown;
}

/** EPG response with the inconsistent fields normalised. */
export interface EpgTransaction {
  serviceType?: string;
  /** Always a string, even where EcoCash returns a number. */
  externalReference: string;
  externalTransactionId?: string;
  transactionId?: string;
  requestId?: string;
  /** Always a number. */
  status?: number;
  statusCode?: string;
  statusMessage?: string;
  responseCode?: string;
  responseMessage?: string;
  senderNumber?: string;
  senderName?: string;
  senderPostBalance?: string;
  receiverName?: string;
  /** receiverNumber or receiverMsisdn, whichever EcoCash sent. */
  receiverNumber?: string;
  amount?: number;
  currency?: string;
  transferReference?: string;
  /** timestamp or timeStamp, whichever EcoCash sent. */
  timestamp?: string;
  raw: EpgResponseBody;
}
