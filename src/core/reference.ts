import { randomInt } from "crypto";

/**
 * Generates a random 15-digit reference. Digits only, so it is also valid where
 * EcoCash requires a numeric reference (Merchant to Subscriber), and small enough
 * to be sent as a JavaScript number without losing precision.
 */
export function generateReference(): string {
  const first = randomInt(1, 10);
  const rest = randomInt(0, 1e14).toString().padStart(14, "0");
  return `${first}${rest}`;
}
