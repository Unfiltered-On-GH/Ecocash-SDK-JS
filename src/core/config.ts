import { EcoCashError } from "./errors";
import { Environment } from "../types";

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Picks the base URL. Live mode has no public default, so baseURL is required there. */
export function resolveBaseURL(
  environment: Environment | undefined,
  baseURL: string | undefined,
  sandboxURL: string,
  product: string
): string {
  if (baseURL) return baseURL.replace(/\/+$/, "");
  if ((environment ?? "sandbox") === "live") {
    throw new EcoCashError(`${product}: baseURL is required in live mode. EcoCash issues production URLs at go-live.`);
  }
  return sandboxURL;
}

export function requireConfig(product: string, config: object, keys: string[]): void {
  const record = config as Record<string, unknown>;
  const missing = keys.filter((k) => typeof record[k] !== "string" || (record[k] as string).trim() === "");
  if (missing.length) {
    throw new EcoCashError(`${product}: missing config ${missing.join(", ")}`);
  }
}
