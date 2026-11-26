import { EpgResponseBody, EpgTransaction, InstantPaymentResponseBody, Payment } from "../types";

function optString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function optNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function normalizePayment(body: InstantPaymentResponseBody, fallbackReference: string): Payment {
  return {
    reference: optString(body.clientCorrelator) ?? fallbackReference,
    referenceCode: optString(body.referenceCode),
    phoneNumber: optString(body.endUserId),
    ecocashReference: optString(body.ecocashReference),
    originalEcocashReference: optString(body.originalEcocashReference),
    status: optString(body.transactionOperationStatus),
    responseCode: optString(body.responseCode),
    raw: body,
  };
}

export function normalizeEpg(body: EpgResponseBody, fallbackReference: string): EpgTransaction {
  return {
    serviceType: optString(body.serviceType),
    externalReference: optString(body.externalReference) ?? fallbackReference,
    externalTransactionId: optString(body.externalTransactionId),
    transactionId: optString(body.transactionId),
    requestId: optString(body.requestId),
    status: optNumber(body.status),
    statusCode: optString(body.statusCode),
    statusMessage: optString(body.statusMessage),
    responseCode: optString(body.responseCode),
    responseMessage: optString(body.responseMessage),
    senderNumber: optString(body.senderNumber),
    senderName: optString(body.senderName),
    senderPostBalance: optString(body.senderPostBalance),
    receiverName: optString(body.receiverName),
    receiverNumber: optString(body.receiverNumber) ?? optString(body.receiverMsisdn),
    amount: optNumber(body.amount),
    currency: optString(body.currency),
    transferReference: optString(body.transferReference),
    timestamp: optString(body.timestamp) ?? optString(body.timeStamp),
    raw: body,
  };
}
