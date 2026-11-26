import { HttpClient } from "../core/http";
import { DEFAULT_TIMEOUT_MS, requireConfig, resolveBaseURL } from "../core/config";
import { DuplicateReferenceError, EcoCashError, errorFromResponse, toEcoCashError } from "../core/errors";
import { encryptPassword } from "../core/crypto";
import { normalizeEpg } from "../core/normalize";
import { generateReference } from "../core/reference";
import { Result, fail, ok } from "../core/result";
import {
  requireString,
  validateAmount,
  validateCurrency,
  validateMsisdn,
  validateNumericReference,
} from "../core/validate";
import {
  CashInRequest,
  DisburseChangeRequest,
  EpgConfig,
  EpgResponseBody,
  EpgTransaction,
  MerchantToSubscriberRequest,
  TransactionLookupRequest,
} from "../types";

type LookupCurrency = TransactionLookupRequest["currency"];

export const EPG_SANDBOX_URL = "https://developers.ecocash.co.zw/api";

export const DEFAULT_CHANNEL_CODES = {
  cashIn: "700002",
  disburseChange: "800002",
  merchantToSubscriber: "800004",
} as const;

/**
 * Client for the EcoCash EPG services: Enterprise Cash-In, Disburse Change,
 * Merchant to Subscriber and Transaction Lookup.
 *
 * Methods never throw for API, network or input errors; they return a Result.
 * The constructor throws for missing config.
 */
export class EpgClient {
  private readonly http: HttpClient;
  private readonly config: EpgConfig;
  private readonly retries: number;

  constructor(config: EpgConfig) {
    requireConfig("EpgClient", config, ["clientId", "clientSecret"]);
    this.config = config;
    this.retries = Math.max(0, Math.floor(config.retries ?? 0));
    this.http = new HttpClient({
      baseURL: resolveBaseURL(config.environment, config.baseURL, EPG_SANDBOX_URL, "EpgClient"),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: { "X-Client-Id": config.clientId, "X-Client-Secret": config.clientSecret },
      adapter: config.adapter,
    });
  }

  /** Enterprise Cash-In: send funds from your enterprise wallet to a customer. */
  async cashIn(request: CashInRequest): Promise<Result<EpgTransaction>> {
    const reference = request.reference ?? generateReference();
    return this.run(reference, () => ({
      serviceType: "ENTERPRISECASHINV2",
      externalReference: reference,
      beneficiaryReference: requireString("beneficiaryReference", request.beneficiaryReference),
      amount: String(validateAmount(request.amount)),
      currency: validateCurrency(request.currency),
      transferReference: request.transferReference ?? "ENTERPRISECASHIN",
      msisdn: validateMsisdn(request.phoneNumber),
      ...this.credentials(),
      channelCode: this.channelCode("cashIn"),
      walletId: this.config.walletId ?? "12",
    }), request);
  }

  /** Disburse Change: send a customer their change from a till. */
  async disburseChange(request: DisburseChangeRequest): Promise<Result<EpgTransaction>> {
    const reference = request.reference ?? generateReference();
    return this.run(reference, () => ({
      serviceType: "CHANGEDISBURSEV2",
      externalReference: reference,
      receiverNumber: validateMsisdn(request.phoneNumber),
      amount: String(validateAmount(request.amount)),
      currency: validateCurrency(request.currency),
      transferReference: request.transferReference ?? "Change Disbursement",
      ...this.credentials(),
      terminalId: requireString("terminalId", request.terminalId ?? this.config.terminalId),
      channelCode: this.channelCode("disburseChange"),
      merchantName: requireString("merchantName", request.merchantName ?? this.config.merchantName),
    }), request);
  }

  /** Merchant to Subscriber: pay a customer from a merchant wallet. The reference must be digits only. */
  async merchantToSubscriber(request: MerchantToSubscriberRequest): Promise<Result<EpgTransaction>> {
    const reference = request.reference ?? generateReference();
    return this.run(reference, () => ({
      serviceType: "MERCHTOSUBV2",
      externalReference: validateNumericReference(reference),
      amount: String(validateAmount(request.amount)),
      currency: validateCurrency(request.currency),
      msisdn: validateMsisdn(request.phoneNumber),
      ...this.credentials(),
      channelCode: this.channelCode("merchantToSubscriber"),
      transferReference: request.transferReference ?? reference,
      walletId: this.config.walletId ?? "12",
    }), request);
  }

  /**
   * Transaction Lookup: find a transaction you sent earlier by its externalReference.
   * Needs client credentials only. Not found returns TransactionNotFoundError (888803).
   * `result.reference` is the reference of the transaction looked up.
   */
  async lookupTransaction(request: TransactionLookupRequest): Promise<Result<EpgTransaction>> {
    const target = typeof request.transactionReference === "string" ? request.transactionReference.trim() : "";
    const lookupReference = request.lookupReference ?? generateReference();
    return this.run(target, () => ({
      serviceType: "EXTERNALTRANSACTIONLOOKUP",
      externalReference: lookupReference,
      externalTransactionId: requireString("transactionReference", request.transactionReference),
      currency: validateCurrency(request.currency),
      msisdn: validateMsisdn(request.phoneNumber),
    }));
  }

  private channelCode(service: keyof typeof DEFAULT_CHANNEL_CODES): string {
    return this.config.channelCodes?.[service] ?? DEFAULT_CHANNEL_CODES[service];
  }

  private credentials(): { username: string; password: string } {
    const c = this.config;
    const username = c.username;
    if (!username) {
      throw new EcoCashError("EpgClient: username is required for this service");
    }
    if (c.encryptedPassword) return { username, password: c.encryptedPassword };
    if (!c.password) {
      throw new EcoCashError("EpgClient: password (with encryptionKey or encryptPassword) or encryptedPassword is required");
    }
    if (c.encryptPassword) return { username, password: c.encryptPassword(c.password) };
    if (c.encryptionKey) return { username, password: encryptPassword(c.password, c.encryptionKey) };
    throw new EcoCashError("EpgClient: encryptionKey is required to encrypt the password");
  }

  /**
   * Builds the body, sends it, and resends on retryable errors up to `retries` times.
   *
   * EPG is not idempotent: it rejects a reused externalReference with a 400. A resend
   * still cannot pay twice, but if the first attempt went through, the resend fails with
   * DuplicateReferenceError. In that case the SDK looks the transaction up and returns it
   * with `recovered: true`. Config errors from building the body are thrown, not returned.
   */
  private async run(
    reference: string,
    build: () => Record<string, unknown>,
    recover?: { phoneNumber: string; currency: LookupCurrency }
  ): Promise<Result<EpgTransaction>> {
    let body: Record<string, unknown>;
    try {
      body = build();
    } catch (error) {
      const err = toEcoCashError(error);
      if (err.code === "CLIENT_VALIDATION") return fail(err, reference);
      throw err;
    }

    let lastError: EcoCashError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.http.post<EpgResponseBody>("/serviceRequest", body);
        const data: EpgResponseBody = response !== null && typeof response === "object" ? response : {};
        if (typeof data.responseCode === "string" && data.responseCode !== "00") {
          return fail(errorFromResponse(typeof data.status === "number" ? data.status : Number(data.status) || 200, data), reference);
        }
        return ok(normalizeEpg(data, reference), reference);
      } catch (error) {
        lastError = toEcoCashError(error);
        if (attempt > 0 && recover && lastError instanceof DuplicateReferenceError) {
          const found = await this.lookupTransaction({ transactionReference: reference, ...recover });
          if (found.success) return ok(found.data, reference, true);
          break;
        }
        if (!lastError.retryable) break;
      }
    }
    return fail(lastError as EcoCashError, reference);
  }
}
