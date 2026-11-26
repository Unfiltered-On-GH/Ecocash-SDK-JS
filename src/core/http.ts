import axios, { AxiosAdapter, AxiosInstance } from "axios";
import { toEcoCashError } from "./errors";

export interface HttpClientOptions {
  baseURL: string;
  timeoutMs: number;
  headers?: Record<string, string>;
  auth?: { username: string; password: string };
  /** Custom axios adapter. Mainly for tests. */
  adapter?: AxiosAdapter;
}

/** Thin axios wrapper. Every failure is thrown as an EcoCashError. */
export class HttpClient {
  private readonly client: AxiosInstance;

  constructor(options: HttpClientOptions) {
    this.client = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      auth: options.auth,
      adapter: options.adapter,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });
  }

  async get<T>(url: string): Promise<T> {
    try {
      const response = await this.client.get<T>(url);
      return response.data;
    } catch (error) {
      throw toEcoCashError(error);
    }
  }

  async post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    try {
      const response = await this.client.post<T>(url, body, { headers });
      return response.data;
    } catch (error) {
      throw toEcoCashError(error);
    }
  }
}
