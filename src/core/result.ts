import { EcoCashError } from "./errors";

export interface SuccessResult<T> {
  success: true;
  data: T;
  /** The reference you can use to look this transaction up. Always set. */
  reference: string;
  /** True when the call timed out and the outcome was recovered with a lookup. */
  recovered?: boolean;
}

export interface FailureResult {
  success: false;
  error: EcoCashError;
  /** The reference that was sent (or would have been). Always set, so you can look it up later. */
  reference: string;
}

export type Result<T> = SuccessResult<T> | FailureResult;

export function ok<T>(data: T, reference: string, recovered?: boolean): SuccessResult<T> {
  return recovered ? { success: true, data, reference, recovered } : { success: true, data, reference };
}

export function fail(error: EcoCashError, reference: string): FailureResult {
  return { success: false, error, reference };
}
