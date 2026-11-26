import { HttpClient } from "../core/http";
import { DEFAULT_TIMEOUT_MS, requireConfig, resolveBaseURL } from "../core/config";
import {
  NetworkError,
  TransactionNotFoundError,
  ValidationError,
  errorFromResponse,
  toEcoCashError,
} from "../core/errors";
import { normalizePayment } from "../core/normalize";
import { generateReference } from "../core/reference";
import { Result, fail, ok } from "../core/result";
import { requireString, validateAmount, validateCurrency, validateEconetNumber } from "../core/validate";
import {
  ChargeRequest,
  Currency,
  InstantPaymentResponseBody,
  LookupRequest,
  OnlinePaymentsConfig,
  Payment,
  RefundRequest,
} from "../types";

export const ONLINE_SANDBOX_URL = "https://developers.ecocash.co.zw/sandbox/payment/v1";

type TranType = "MER" | "REF" | "REV";

interface AmountFields {
  amount: number;
  currency: Currency;
  description: string;
  referenceCode?: string;
  notifyUrl?: string;
}

/**
 * Client for the EcoCash Online (Instant) Payments API: charge a customer's wallet,
 * look a charge up, and refund or reverse it.
 *
 * Methods never throw for API, network or input errors; they return a Result.
 * The constructor throws for missing config.
 */
export class OnlinePayments {
  private readonly http: HttpClient;
  private readonly config: OnlinePaymentsConfig;

  constructor(config: OnlinePaymentsConfig) {
    requireConfig("OnlinePayments", config, [
      "username",
      "password",
      "merchantCode",
      "merchantPin",
      "merchantNumber",
      "terminalId",
      "location",
      "merchantName",
      "superMerchantName",
    ]);
    this.config = config;
    this.http = new HttpClient({
      baseURL: resolveBaseURL(config.environment, config.baseURL, ONLINE_SANDBOX_URL, "OnlinePayments"),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      auth: { username: config.username, password: config.password },
      adapter: config.adapter,
    });
  }

  /**
   * Charges the customer's wallet. The customer approves on their handset.
   *
   * If the request times out the outcome is unknown, so the SDK looks the charge up
   * once. It never resends, because a resend is rejected with E005. If the lookup
   * finds the charge the result has `recovered: true`; otherwise the timeout error is
   * returned and you should look it up later with `result.reference`.
   */
  async charge(request: ChargeRequest): Promise<Result<Payment>> {
    const reference = request.reference ?? generateReference();
    let phoneNumber: string;
    let body: Record<string, unknown>;
    try {
      phoneNumber = validateEconetNumber(request.phoneNumber);
      body = this.buildBody("MER", reference, phoneNumber, request);
    } catch (error) {
      return fail(toEcoCashError(error), reference);
    }

    try {
      const response = await this.http.post<InstantPaymentResponseBody>("/transactions/amount/", body);
      return this.toResult(response, reference);
    } catch (error) {
      const err = toEcoCashError(error);
      if (err instanceof NetworkError && err.timedOut) {
        const lookup = await this.lookup({ phoneNumber, reference });
        if (lookup.success) return ok(lookup.data, reference, true);
      }
      return fail(err, reference);
    }
  }

  /** Returns the current state of a charge by phone number and clientCorrelator. */
  async lookup(request: LookupRequest): Promise<Result<Payment>> {
    const reference = typeof request.reference === "string" ? request.reference.trim() : "";
    try {
      const phone = validateEconetNumber(request.phoneNumber);
      requireString("reference", request.reference);
      const response = await this.http.get<InstantPaymentResponseBody>(
        `/${encodeURIComponent(phone)}/transactions/amount/${encodeURIComponent(reference)}`
      );
      return this.toResult(response, reference);
    } catch (error) {
      return fail(toEcoCashError(error), reference);
    }
  }

  /** Refunds a settled charge (tranType REF). The amount may not exceed the original. */
  refund(request: RefundRequest): Promise<Result<Payment>> {
    return this.refundOrReverse("REF", request);
  }

  /** Reverses a settled charge (tranType REV). */
  reverse(request: RefundRequest): Promise<Result<Payment>> {
    return this.refundOrReverse("REV", request);
  }

  /**
   * Parses the JSON body EcoCash posts to your notifyUrl. Pass the parsed object or the
   * raw string. The callback format is not fully documented, so `raw` keeps everything.
   * Throws ValidationError if the body is not a JSON object.
   */
  parseNotification(body: unknown): Payment {
    let value = body;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        throw new ValidationError("Notification body is not valid JSON", { code: "CLIENT_VALIDATION" });
      }
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ValidationError("Notification body must be a JSON object", { code: "CLIENT_VALIDATION" });
    }
    return normalizePayment(value as InstantPaymentResponseBody, "");
  }

  private async refundOrReverse(tranType: "REF" | "REV", request: RefundRequest): Promise<Result<Payment>> {
    const reference = request.reference ?? generateReference();
    try {
      const phone = validateEconetNumber(request.phoneNumber);
      const original = requireString("originalEcocashReference", request.originalEcocashReference);
      const body = this.buildBody(tranType, reference, phone, request);
      body.originalEcocashReference = original;
      const response = await this.http.post<InstantPaymentResponseBody>("/transactions/refund/", body);
      return this.toResult(response, reference);
    } catch (error) {
      return fail(toEcoCashError(error), reference);
    }
  }

  private buildBody(tranType: TranType, reference: string, phoneNumber: string, request: AmountFields): Record<string, unknown> {
    const amount = validateAmount(request.amount);
    const currency = validateCurrency(request.currency);
    const description = requireString("description", request.description);
    const c = this.config;

    const chargeMetaData: Record<string, string> = { channel: c.channel ?? "WEB" };
    if (c.purchaseCategoryCode) chargeMetaData.purchaseCategoryCode = c.purchaseCategoryCode;
    if (c.onBehalfOf) chargeMetaData.onBeHalfOf = c.onBehalfOf;

    const body: Record<string, unknown> = {
      clientCorrelator: reference,
      referenceCode: request.referenceCode ?? reference,
      tranType,
      endUserId: phoneNumber,
      paymentAmount: {
        charginginformation: { amount, currency, description },
        chargeMetaData,
      },
      merchantCode: c.merchantCode,
      merchantPin: c.merchantPin,
      merchantNumber: c.merchantNumber,
      countryCode: c.countryCode ?? "ZW",
      terminalID: c.terminalId,
      location: c.location,
      superMerchantName: c.superMerchantName,
      merchantName: c.merchantName,
    };
    const notifyUrl = request.notifyUrl ?? c.notifyUrl;
    if (notifyUrl) body.notifyUrl = notifyUrl;
    return body;
  }

  /**
   * A 200 is not always a success. EcoCash also uses 200 for:
   * - an error code (`statusCode` E0xx, or a `responseCode` other than "00");
   * - `{ messageId, text }` with no transaction, e.g. a rejected refund or a resent reference;
   * - a lookup of an unknown reference, where every field is null.
   */
  private toResult(response: InstantPaymentResponseBody, reference: string): Result<Payment> {
    const body: InstantPaymentResponseBody =
      response !== null && typeof response === "object" ? response : {};
    const responseCode = body.responseCode;
    const statusCode = body.statusCode;
    if ((typeof responseCode === "string" && responseCode !== "00") || (typeof statusCode === "string" && /^E\d{3}$/.test(statusCode))) {
      return fail(errorFromResponse(200, body), reference);
    }
    const isTransaction = hasValue(body.transactionOperationStatus) || hasValue(body.clientCorrelator);
    if (!isTransaction) {
      if (hasValue(body.messageId) || hasValue(body.text)) {
        return fail(errorFromResponse(200, body), reference);
      }
      if (responseCode !== "00") {
        return fail(
          new TransactionNotFoundError(`No transaction found for reference ${reference}`, { httpStatus: 200, body }),
          reference
        );
      }
    }
    return ok(normalizePayment(body, reference), reference);
  }
}

function hasValue(value: unknown): boolean {
  return (typeof value === "string" && value.trim() !== "") || typeof value === "number";
}
