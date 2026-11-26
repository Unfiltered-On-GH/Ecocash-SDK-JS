import { AxiosAdapter, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";

export interface RecordedRequest {
  method?: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply =
  | { status: number; data: unknown }
  | { timeout: true }
  | { networkError: true };

/** An axios adapter that answers from a queue of replies and records every request. */
export function mockAdapter(replies: Reply[]): { adapter: AxiosAdapter; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];

  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const headers: Record<string, string> = {};
    const raw = config.headers?.toJSON ? config.headers.toJSON() : {};
    for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = String(v);
    // axios's own adapters turn `auth` into the Authorization header; do the same here.
    if (config.auth) {
      headers.authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password}`).toString("base64")}`;
    }
    requests.push({
      method: config.method,
      url: `${config.baseURL ?? ""}${config.url ?? ""}`,
      headers,
      body: typeof config.data === "string" ? JSON.parse(config.data) : config.data,
    });

    const reply = queue.shift();
    if (!reply) throw new Error("mockAdapter: no reply queued");
    if ("timeout" in reply) throw new AxiosError("timeout of 30000ms exceeded", "ECONNABORTED", config, {});
    if ("networkError" in reply) throw new AxiosError("socket hang up", "ECONNRESET", config, {});

    const response: AxiosResponse = {
      status: reply.status,
      statusText: String(reply.status),
      data: reply.data,
      headers: {},
      config,
    };
    if (reply.status >= 400) {
      throw new AxiosError(`Request failed with status code ${reply.status}`, "ERR_BAD_RESPONSE", config, {}, response);
    }
    return response;
  };

  return { adapter, requests };
}

export const TEST_PHONE = "771234567";
export const TEST_MSISDN = "263777000000";
