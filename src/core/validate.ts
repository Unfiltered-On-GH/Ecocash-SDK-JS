import { ValidationError } from "./errors";
import { Currency } from "../types";

const CLIENT_VALIDATION = "CLIENT_VALIDATION";

function fail(message: string): never {
  throw new ValidationError(message, { code: CLIENT_VALIDATION });
}

export function requireString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`Missing required field: ${name}`);
  }
  return value.trim();
}

/** Amount must be a finite number above 0 with at most 2 decimal places. */
export function validateAmount(amount: unknown): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    fail("amount must be a number greater than 0");
  }
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    fail("amount must have at most 2 decimal places");
  }
  return amount;
}

export function validateCurrency(currency: unknown): Currency {
  if (currency !== "USD" && currency !== "ZWG") {
    fail(`Unsupported currency: ${String(currency)}. Accepted values are USD and ZWG.`);
  }
  return currency;
}

function clean(phone: unknown, name: string): string {
  return requireString(name, phone).replace(/[\s-]/g, "").replace(/^\+/, "");
}

/**
 * Online (Instant) Payments: an Econet number (077 or 078) as 9, 10 or 12 digits,
 * e.g. 771234567, 0771234567 or 263771234567.
 */
export function validateEconetNumber(phone: unknown, name = "phoneNumber"): string {
  const value = clean(phone, name);
  if (!/^(?:7[78]\d{7}|07[78]\d{7}|2637[78]\d{7})$/.test(value)) {
    fail(`${name} must be an Econet number (077 or 078) as 9, 10 or 12 digits`);
  }
  return value;
}

/** EPG services: 263XXXXXXXXX or 07XXXXXXXX. EcoCash normalises the format itself. */
export function validateMsisdn(phone: unknown, name = "phoneNumber"): string {
  const value = clean(phone, name);
  if (!/^(?:263\d{9}|07\d{8})$/.test(value)) {
    fail(`${name} must be in the format 263XXXXXXXXX or 07XXXXXXXX`);
  }
  return value;
}

/** References must be non-empty; numeric ones must fit in a JavaScript number. */
export function validateNumericReference(reference: string, name = "externalReference"): number {
  if (!/^\d+$/.test(reference)) {
    fail(`${name} must contain digits only for this service`);
  }
  const value = Number(reference);
  if (!Number.isSafeInteger(value)) {
    fail(`${name} is too large to send as a number (max ${Number.MAX_SAFE_INTEGER})`);
  }
  return value;
}
